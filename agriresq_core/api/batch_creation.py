import json
from decimal import Decimal
from urllib.error import HTTPError

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .device_views import CROPS, gallery_listing_status, operator_devices
from .models import DeviceScan
from .scan_listing import BATCH_DEADLINE_EXPIRED, listing_deadline
from .supabase_auth import IsStallOperator, SupabaseAuthentication
from .supabase_client import has_service_key, supabase_insert


class BatchDetails(serializers.Serializer):
    crop_type = serializers.ChoiceField(choices=sorted(CROPS))
    quantity_kg = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=Decimal('0.01'))
    base_price_per_kg = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)
    current_price_per_kg = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)
    discount_percent = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100)
    discount_override_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=0, max_value=100, allow_null=True, required=False,
    )
    auto_discount_enabled = serializers.BooleanField(default=True)
    freshness_status = serializers.ChoiceField(choices=('GREEN', 'AMBER', 'RED'))
    freshness_percent = serializers.IntegerField(min_value=0, max_value=100)
    predicted_shelf_life = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0)
    harvest_datetime = serializers.DateTimeField(allow_null=True, required=False)
    image_url = serializers.URLField()
    notes = serializers.CharField(allow_blank=True, default='', max_length=5000)
    pickup_location = serializers.CharField(default='Bulua West Terminal', max_length=255)


class CreateBatchFromScanView(APIView):
    authentication_classes = [SupabaseAuthentication]
    permission_classes = [IsAuthenticated, IsStallOperator]

    def post(self, request, scan_id):
        if not has_service_key():
            return Response({'detail': 'Batch creation is temporarily unavailable.'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        operator_id = request.user.id
        scan = DeviceScan.objects.filter(pk=scan_id).first()
        if scan is None or (scan.operator_id != operator_id
                            and not operator_devices(operator_id).filter(pk=scan.device_id).exists()):
            raise NotFound('Scan not found.')
        deadline = listing_deadline(scan)
        now = timezone.now()
        if not scan.created_at <= now < deadline:
            raise ValidationError({'scan': BATCH_DEADLINE_EXPIRED})
        details = BatchDetails(data=request.data)
        details.is_valid(raise_exception=True)
        values = details.data
        severity = {'GREEN': 0, 'AMBER': 1, 'RED': 2}
        if (not scan.detected or scan.crop_mismatch or scan.low_confidence or not scan.image
                or scan.detected_crop != values['crop_type']
                or severity[values['freshness_status']] < severity.get(scan.freshness_status, 0)):
            raise ValidationError({'scan': 'Run a new scan that clearly shows the selected produce.'})
        try:
            sources, _ = gallery_listing_status([scan], now)
            if scan.id in sources:
                raise ValidationError({'scan': 'This scan is already linked to a batch.'})
            if timezone.now() >= deadline:
                raise ValidationError({'scan': BATCH_DEADLINE_EXPIRED})
            batch = supabase_insert('products', {
                **values,
                'operator_id': operator_id,
                'source_scan_id': scan.id,
                'scan_listing_deadline': deadline.isoformat(),
                'ml_confidence': scan.ml_confidence,
                'is_listed': False,
            })
        except HTTPError as exc:
            try:
                error = json.load(exc)
            except (ValueError, TypeError):
                error = {}
            if error.get('code') == '23505':
                raise ValidationError({'scan': 'This scan is already linked to a batch.'}) from exc
            if error.get('message') == BATCH_DEADLINE_EXPIRED:
                raise ValidationError({'scan': BATCH_DEADLINE_EXPIRED}) from exc
            return Response({'detail': 'Could not save the batch. Try again shortly.'},
                            status=status.HTTP_502_BAD_GATEWAY)
        except OSError:
            return Response({'detail': 'Could not reach the batch service. Try again shortly.'},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response(batch, status=status.HTTP_201_CREATED)
