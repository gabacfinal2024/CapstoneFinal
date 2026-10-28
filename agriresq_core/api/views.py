from decimal import Decimal
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone
from django.http.request import UnreadablePostError
from rest_framework import viewsets, status, generics
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import BaseParser, MultiPartParser
from rest_framework.exceptions import ParseError

from .authentication import IoTDeviceAuthentication
from .models import (
    UserProfile, WholesalerProfile, RescueBuyerProfile,
    IoTNode, CropBatch, SensorLog, SpoilagePrediction,
    MarketplaceListing, PushNotification, ChatThread, ChatMessage,
)
from .permissions import IsWholesaler, IsWholesalerOrReadOnly
from .serializers import (
    RegisterSerializer, UserSerializer, WholesalerProfileSerializer,
    IoTNodeSerializer, CropBatchSerializer, SensorLogSerializer,
    SpoilagePredictionSerializer, MarketplaceListingSerializer,
    PushNotificationSerializer, ChatThreadSerializer, ChatMessageSerializer,
    SensorDataIngestSerializer, DashboardSerializer,
)
from .services import process_sensor_reading
from .spoilage_engine import predict_spoilage, CROP_CONFIG

class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        return Response({
            'token': token.key,
            'user': UserSerializer(user).data,
        }, status=status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get('email', '').lower()
        password = request.data.get('password', '')
        try:
            user = User.objects.get(email__iexact=email)
            authenticated = authenticate(username=user.username, password=password)
        except User.DoesNotExist:
            authenticated = None
        if not authenticated:
            return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)
        token, _ = Token.objects.get_or_create(user=authenticated)
        return Response({'token': token.key, 'user': UserSerializer(authenticated).data})


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response({'detail': 'Logged out.'})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = UserSerializer(request.user).data
        profile = getattr(request.user, 'profile', None)
        if profile and profile.role == 'WHOLESALER':
            wp = getattr(request.user, 'wholesaler_profile', None)
            if wp:
                data['wholesaler'] = WholesalerProfileSerializer(wp).data
        elif profile and profile.role == 'RESCUE_BUYER':
            bp = getattr(request.user, 'buyer_profile', None)
            if bp:
                data['buyer_type'] = bp.buyer_type
        return Response(data)

class SensorDataView(APIView):
    """IoT endpoint: POST /api/sensor-data/ with X-Device-Token header."""
    authentication_classes = [IoTDeviceAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = []

    def post(self, request):
        iot_node = request.auth
        serializer = SensorDataIngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        log, batch = process_sensor_reading(
            iot_node=iot_node,
            batch_id=data.get('batch_id'),
            temp_c=data['temperature_c'],
            rh=data['humidity_rh'],
            ethylene_ppm=data.get('ethylene_ppm'),
        )
        return Response({
            'status': 'processed',
            'log_id': log.id,
            'batch_id': batch.id if batch else None,
            'freshness_status': batch.freshness_status if batch else None,
            'days_to_spoil': float(batch.predicted_shelf_life) if batch else None,
        }, status=status.HTTP_201_CREATED)

    def get(self, request):
        iot_node = request.auth
        logs = SensorLog.objects.filter(iot_node=iot_node)[:50]
        return Response(SensorLogSerializer(logs, many=True).data)


class LogsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = getattr(request.user, 'profile', None)
        logs = SensorLog.objects.none()

        if request.user.is_staff or request.user.is_superuser:
            logs = SensorLog.objects.all().select_related('iot_node')[:50]
        elif profile and profile.role == 'WHOLESALER':
            wp = getattr(request.user, 'wholesaler_profile', None)
            if wp:
                logs = SensorLog.objects.filter(
                    iot_node__wholesaler=wp
                ).select_related('iot_node')[:50]

        return Response(SensorLogSerializer(logs, many=True).data)


class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = getattr(request.user, 'profile', None)
        batches = CropBatch.objects.none()
        latest_log = None

        if profile and profile.role == 'WHOLESALER':
            wp = getattr(request.user, 'wholesaler_profile', None)
            if wp:
                batches = CropBatch.objects.filter(wholesaler=wp).exclude(
                    freshness_status='RED'
                ).select_related('wholesaler', 'iot_node')[:20]
                latest_log = SensorLog.objects.filter(
                    iot_node__wholesaler=wp
                ).first()
        elif profile and profile.role == 'RESCUE_BUYER':
            batches = CropBatch.objects.filter(
                is_listed=True, freshness_status__in=['GREEN', 'AMBER']
            ).select_related('wholesaler')[:10]

        data = {
            'active_batches': CropBatchSerializer(batches, many=True).data,
            'live_temperature': latest_log.temperature_c if latest_log else None,
            'live_humidity': latest_log.humidity_rh if latest_log else None,
            'live_ethylene': latest_log.ethylene_ppm if latest_log else None,
            'unread_notifications': PushNotification.objects.filter(
                user=request.user, is_read=False
            ).count(),
            'at_risk_count': batches.filter(freshness_status='AMBER').count()
            if hasattr(batches, 'filter') else 0,
        }
        return Response(data)


class PredictView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, batch_id):
        try:
            batch = CropBatch.objects.get(pk=batch_id)
        except CropBatch.DoesNotExist:
            return Response({'detail': 'Batch not found.'}, status=404)
        latest = batch.sensor_logs.first()
        if not latest:
            return Response({
                'batch_id': batch.id,
                'status': batch.freshness_status,
                'days_to_spoil': float(batch.predicted_shelf_life),
                'message': 'No sensor data yet.',
            })
        status_val, days, chu, vpd = predict_spoilage(
            crop_type=batch.crop_type,
            current_shelf_life=batch.predicted_shelf_life,
            temp_c=latest.temperature_c,
            rh=latest.humidity_rh,
        )
        return Response({
            'batch_id': batch.id,
            'status': status_val,
            'days_to_spoil': float(days),
            'chu_accumulated': float(chu),
            'vpd': float(vpd),
            'temperature_c': float(latest.temperature_c),
            'humidity_rh': float(latest.humidity_rh),
        })

class CropBatchViewSet(viewsets.ModelViewSet):
    serializer_class = CropBatchSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        qs = CropBatch.objects.select_related('wholesaler', 'iot_node').prefetch_related('sensor_logs')
        profile = getattr(self.request.user, 'profile', None)
        if not profile:
            return qs.none()
        if profile.role == 'WHOLESALER':
            wp = getattr(self.request.user, 'wholesaler_profile', None)
            return qs.filter(wholesaler=wp) if wp else qs.none()
        crop = self.request.query_params.get('crop_type')
        status_filter = self.request.query_params.get('status')
        if crop:
            qs = qs.filter(crop_type=crop.upper())
        if status_filter:
            qs = qs.filter(freshness_status=status_filter.upper())
        return qs.filter(is_listed=True).exclude(freshness_status='RED')

    def perform_create(self, serializer):
        wp = self.request.user.wholesaler_profile
        serializer.save(wholesaler=wp)


class MarketplaceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MarketplaceListingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = MarketplaceListing.objects.filter(
            listing_status='ACTIVE',
            expires_at__gt=timezone.now(),
        ).select_related('crop_batch', 'wholesaler', 'wholesaler__user')
        crop = self.request.query_params.get('crop_type')
        category = self.request.query_params.get('category')
        if crop:
            qs = qs.filter(crop_batch__crop_type=crop.upper())
        if category == 'vegetables':
            qs = qs.filter(crop_batch__crop_type__in=['EGGPLANT', 'CUCUMBER', 'CARROT'])
        return qs

    @action(detail=True, methods=['post'])
    def chat(self, request, pk=None):
        listing = self.get_object()
        thread, _ = ChatThread.objects.get_or_create(
            listing=listing,
            buyer=request.user,
            defaults={'wholesaler': listing.wholesaler.user},
        )
        return Response(ChatThreadSerializer(thread, context={'request': request}).data)


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = PushNotificationSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'patch', 'post']

    def get_queryset(self):
        return PushNotification.objects.filter(user=self.request.user)

    @action(detail=True, methods=['post'])
    def acknowledge(self, request, pk=None):
        notif = self.get_object()
        notif.is_acknowledged = True
        notif.is_read = True
        notif.save()
        return Response(PushNotificationSerializer(notif).data)

    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        self.get_queryset().update(is_read=True)
        return Response({'detail': 'All marked read.'})


class ChatThreadViewSet(viewsets.ModelViewSet):
    serializer_class = ChatThreadSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post']

    def get_queryset(self):
        user = self.request.user
        return ChatThread.objects.filter(
            Q(wholesaler=user) | Q(buyer=user)
        ).select_related('listing', 'wholesaler', 'buyer').prefetch_related('messages')

    @action(detail=True, methods=['post'])
    def send_message(self, request, pk=None):
        thread = self.get_object()
        text = request.data.get('message_text', '').strip()
        if not text:
            return Response({'detail': 'Message required.'}, status=400)
        msg = ChatMessage.objects.create(
            thread=thread, sender=request.user, message_text=text
        )
        other = thread.buyer if thread.wholesaler_id == request.user.id else thread.wholesaler
        PushNotification.objects.create(
            user=other,
            notification_type='NEW_MESSAGE',
            title='New Message',
            message=text[:100],
        )
        return Response(ChatMessageSerializer(msg).data, status=201)


class IoTNodeViewSet(viewsets.ModelViewSet):
    """
    Manage IoT sensor nodes.

    FIX: previously this used `permission_classes = [AllowAny]` combined
    with a `get_queryset()` that depended on `request.user.wholesaler_profile`.
    That mismatch meant:
      - Anonymous requests (no/invalid token) were *allowed in* by the
        permission class, but then silently got an EMPTY queryset back
        from get_queryset() (since AnonymousUser has no wholesaler_profile).
      - Authenticated requests from a user without a WholesalerProfile
        (e.g. staff/admin/test accounts) hit the same silent empty queryset.
      - Either way, GET /api/nodes/1/ resolves against an empty queryset,
        so DRF raises Http404 -> the "Not Found: /api/nodes/1/" you saw
        in the server logs, even though the node genuinely exists in the DB.

    This version:
      1. Requires authentication (no more AllowAny) so unauthenticated
         calls get a clear 401 instead of a confusing 404.
      2. Lets staff/superusers see all nodes (useful for the admin
         terminal / debugging).
      3. Still scopes normal wholesaler users to only their own nodes.
      4. Returns .none() (empty list, not a 404) only for users who are
         authenticated but have no wholesaler profile and aren't staff —
         which is the only case where "no nodes" is actually correct.
    """
    serializer_class = IoTNodeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        if user.is_staff or user.is_superuser:
            return IoTNode.objects.all()

        wp = getattr(user, 'wholesaler_profile', None)
        if wp:
            return IoTNode.objects.filter(wholesaler=wp)

        return IoTNode.objects.none()

    def perform_create(self, serializer):
        wp = self.request.user.wholesaler_profile
        serializer.save(
            wholesaler=wp,
            device_token=IoTNode.generate_token(),
        )

class ImageParser(BaseParser):
    """Custom parser to receive raw image bytes directly from ESP32-CAM"""
    media_type = 'image/jpeg'

    def parse(self, stream, media_type=None, parser_context=None):
        try:
            # We add a check for Content-Length to avoid reading empty streams
            content_length = int(parser_context.get('request').META.get('CONTENT_LENGTH', 0))
            if content_length == 0:
                return None
            return stream.read()
        except UnreadablePostError:
            raise ParseError("Client dropped the connection mid-transfer.")


class AnalyzeFreshnessView(APIView):
    """POST /api/analyze-freshness/ — ESP32-CAM or mobile upload."""
    permission_classes = [AllowAny]
    # Allow both Web Uploads (MultiPart) and ESP32 Uploads (ImageParser)
    parser_classes = [MultiPartParser, ImageParser]

    def post(self, request):
        try:
            # 1. Handle ESP32-CAM (Raw JPEG Bytes)
            if request.content_type == 'image/jpeg':
                image_bytes = request.data  # The ImageParser gives us the bytes here
                if image_bytes is None:
                    return Response({'error': 'No image data received.'}, status=400)
                crop_type = request.headers.get('X-Crop-Type', 'EGGPLANT').upper()

            # 2. Handle React Web App / Mobile App (Multipart Form)
            else:
                image_file = request.FILES.get('image')
                if not image_file:
                    return Response({'error': 'Image file required.'}, status=400)
                image_bytes = image_file.read()
                crop_type = request.data.get('crop_type', 'EGGPLANT').upper()

            from .vision import analyze_crop_image
            result = analyze_crop_image(image_bytes, crop_type)
            return Response(result)

        except Exception as e:
            # Catch the error so your server doesn't show an "Internal Server Error"
            print(f"Vision Analysis Error: {e}")
            return Response({'error': 'Failed to process image'}, status=400)


class IotAnalyzeProductView(APIView):
    """
    POST /api/iot/analyze-product/
    ESP32-CAM flow: image + metadata → analyze → save to Supabase → return result.
    Headers: X-Device-Token
    """
    authentication_classes = [IoTDeviceAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = []

    def post(self, request):
        image = request.FILES.get('image')
        crop_type = request.data.get('crop_type', 'EGGPLANT').upper()
        quantity_kg = request.data.get('quantity_kg', 10)
        base_price = request.data.get('base_price_per_kg', 30)
        operator_id = request.data.get('operator_id')

        if not image:
            return Response({'error': 'Image required from ESP32-CAM.'}, status=400)

        from .vision import analyze_crop_image
        from .supabase_client import supabase_insert
        from decimal import Decimal

        result = analyze_crop_image(image.read(), crop_type)
        if not result['detected'] or result['crop_mismatch']:
            return Response(result, status=200)     # nothing to save: no eggplant/cucumber/carrot in view
        status = result['freshness_status']
        discount = {'GREEN': 0, 'AMBER': 30, 'RED': 100}[status]
        current_price = float(base_price) * (1 - discount / 100)

        iot_node = request.auth
        op_id = operator_id or str(getattr(iot_node.wholesaler.user, 'id', ''))

        try:
            product = supabase_insert('products', {
                'operator_id': op_id,
                'iot_node_id': iot_node.id,
                'crop_type': crop_type,
                'quantity_kg': quantity_kg,
                'base_price_per_kg': base_price,
                'current_price_per_kg': current_price,
                'discount_percent': discount,
                'freshness_status': status,
                'freshness_percent': result['freshness_percent'],
                'predicted_shelf_life': result['days_to_spoil'],
                'ml_confidence': result['ml_confidence'],
                'harvest_datetime': timezone.now().isoformat(),
                'is_listed': status != 'RED',
            })
            result['product_id'] = product.get('id')
        except Exception as exc:
            result['supabase_warning'] = str(exc)

        return Response(result, status=201)
    
