from decimal import Decimal
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from .models import (
    UserProfile, WholesalerProfile, RescueBuyerProfile,
    IoTNode, CropBatch, SensorLog, SpoilagePrediction,
    MarketplaceListing, PushNotification, ChatThread, ChatMessage,
)


class UserSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    phone_number = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'role', 'phone_number']

    def get_role(self, obj):
        profile = getattr(obj, 'profile', None)
        return profile.role if profile else None

    def get_phone_number(self, obj):
        profile = getattr(obj, 'profile', None)
        return profile.phone_number if profile else ''


class RegisterSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    phone_number = serializers.CharField(max_length=20, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, min_length=8)
    role = serializers.ChoiceField(choices=['WHOLESALER', 'RESCUE_BUYER'])
    stall_number = serializers.CharField(max_length=50, required=False, allow_blank=True)
    buyer_type = serializers.ChoiceField(
        choices=['RETAILER', 'PROCESSOR', 'CONSUMER'], required=False
    )

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Email already registered.')
        return value.lower()

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate(self, data):
        if data['role'] in ('WHOLESALER', 'STALL_OPERATOR') and not data.get('stall_number'):
            raise serializers.ValidationError({'stall_number': 'Required for stall operators.'})
        return data

    def create(self, validated_data):
        name_parts = validated_data['full_name'].strip().split(' ', 1)
        first_name = name_parts[0]
        last_name = name_parts[1] if len(name_parts) > 1 else ''
        username = validated_data['email'].split('@')[0]
        base_username = username
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f"{base_username}{counter}"
            counter += 1

        user = User.objects.create_user(
            username=username,
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=first_name,
            last_name=last_name,
        )
        UserProfile.objects.create(
            user=user,
            role=validated_data['role'],
            phone_number=validated_data.get('phone_number', ''),
        )
        if validated_data['role'] == 'WHOLESALER':
            WholesalerProfile.objects.create(
                user=user,
                stall_number=validated_data['stall_number'],
            )
        else:
            RescueBuyerProfile.objects.create(
                user=user,
                buyer_type=validated_data.get('buyer_type', 'RETAILER'),
            )
        return user


class WholesalerProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = WholesalerProfile
        fields = '__all__'

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.username


class RescueBuyerProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = RescueBuyerProfile
        fields = '__all__'


class IoTNodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = IoTNode
        fields = '__all__'
        read_only_fields = ['device_token', 'last_seen']


class SensorLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SensorLog
        fields = '__all__'


class SpoilagePredictionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SpoilagePrediction
        fields = '__all__'


class CropBatchSerializer(serializers.ModelSerializer):
    wholesaler_name = serializers.SerializerMethodField()
    stall_number = serializers.SerializerMethodField()
    total_price = serializers.SerializerMethodField()
    latest_temp = serializers.SerializerMethodField()
    latest_humidity = serializers.SerializerMethodField()
    latest_ethylene = serializers.SerializerMethodField()

    class Meta:
        model = CropBatch
        fields = '__all__'
        read_only_fields = ['freshness_status', 'predicted_shelf_life', 'freshness_percent']

    def get_wholesaler_name(self, obj):
        return obj.wholesaler.user.get_full_name() or obj.wholesaler.user.username

    def get_stall_number(self, obj):
        return obj.wholesaler.stall_number

    def get_total_price(self, obj):
        return float(obj.total_price)

    def get_latest_temp(self, obj):
        log = obj.sensor_logs.first()
        return float(log.temperature_c) if log else None

    def get_latest_humidity(self, obj):
        log = obj.sensor_logs.first()
        return float(log.humidity_rh) if log else None

    def get_latest_ethylene(self, obj):
        log = obj.sensor_logs.first()
        return float(log.ethylene_ppm) if log and log.ethylene_ppm else None


class MarketplaceListingSerializer(serializers.ModelSerializer):
    batch = CropBatchSerializer(source='crop_batch', read_only=True)
    wholesaler_name = serializers.SerializerMethodField()

    class Meta:
        model = MarketplaceListing
        fields = '__all__'

    def get_wholesaler_name(self, obj):
        return obj.wholesaler.user.get_full_name() or obj.wholesaler.user.username


class PushNotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushNotification
        fields = '__all__'
        read_only_fields = ['user', 'created_at']


class ChatMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()

    class Meta:
        model = ChatMessage
        fields = '__all__'
        read_only_fields = ['sender', 'sent_at']

    def get_sender_name(self, obj):
        return obj.sender.get_full_name() or obj.sender.username


class ChatThreadSerializer(serializers.ModelSerializer):
    messages = ChatMessageSerializer(many=True, read_only=True)
    listing_title = serializers.SerializerMethodField()
    other_party = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = ChatThread
        fields = '__all__'

    def get_listing_title(self, obj):
        return f"{obj.listing.crop_batch.crop_type} - Stall {obj.listing.wholesaler.stall_number}"

    def get_other_party(self, obj):
        request = self.context.get('request')
        if not request:
            return None
        other = obj.buyer if obj.wholesaler_id == request.user.id else obj.wholesaler
        return UserSerializer(other).data

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if not request:
            return 0
        return obj.messages.filter(is_read=False).exclude(sender=request.user).count()


class SensorDataIngestSerializer(serializers.Serializer):
    batch_id = serializers.IntegerField(required=False)
    temperature_c = serializers.DecimalField(max_digits=5, decimal_places=2)
    humidity_rh = serializers.DecimalField(max_digits=5, decimal_places=2)
    ethylene_ppm = serializers.DecimalField(
        max_digits=6, decimal_places=3, required=False, allow_null=True
    )

    def validate(self, data):
        from .spoilage_engine import validate_sensor_reading
        eth = data.get('ethylene_ppm')
        if not validate_sensor_reading(
            float(data['temperature_c']),
            float(data['humidity_rh']),
            float(eth) if eth else None,
        ):
            raise serializers.ValidationError('Sensor readings out of valid physical range.')
        return data


class DashboardSerializer(serializers.Serializer):
    active_batches = CropBatchSerializer(many=True)
    live_temperature = serializers.DecimalField(max_digits=5, decimal_places=2, allow_null=True)
    live_humidity = serializers.DecimalField(max_digits=5, decimal_places=2, allow_null=True)
    live_ethylene = serializers.DecimalField(max_digits=6, decimal_places=3, allow_null=True)
    unread_notifications = serializers.IntegerField()
    at_risk_count = serializers.IntegerField()
