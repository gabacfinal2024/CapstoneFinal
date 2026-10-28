from django.contrib import admin
from .models import (
    UserProfile, WholesalerProfile, RescueBuyerProfile,
    IoTNode, CropBatch, SensorLog, SpoilagePrediction,
    MarketplaceListing, PushNotification, ChatThread, ChatMessage,
)


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'role', 'phone_number']


@admin.register(WholesalerProfile)
class WholesalerProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'stall_number', 'is_verified']


@admin.register(RescueBuyerProfile)
class RescueBuyerProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'buyer_type']


@admin.register(IoTNode)
class IoTNodeAdmin(admin.ModelAdmin):
    list_display = ['id', 'stall_location', 'wholesaler', 'is_active', 'last_seen']
    readonly_fields = ['device_token']


@admin.register(CropBatch)
class CropBatchAdmin(admin.ModelAdmin):
    list_display = ['id', 'crop_type', 'wholesaler', 'freshness_status', 'predicted_shelf_life', 'is_listed']
    list_filter = ['crop_type', 'freshness_status']


@admin.register(SensorLog)
class SensorLogAdmin(admin.ModelAdmin):
    list_display = ['id', 'iot_node', 'temperature_c', 'humidity_rh', 'timestamp']
    list_filter = ['timestamp']


@admin.register(SpoilagePrediction)
class SpoilagePredictionAdmin(admin.ModelAdmin):
    list_display = ['crop_batch', 'predicted_status', 'days_to_spoil', 'created_at']


@admin.register(MarketplaceListing)
class MarketplaceListingAdmin(admin.ModelAdmin):
    list_display = ['id', 'crop_batch', 'listed_price', 'listing_status', 'expires_at']


@admin.register(PushNotification)
class PushNotificationAdmin(admin.ModelAdmin):
    list_display = ['user', 'notification_type', 'title', 'is_read', 'created_at']


@admin.register(ChatThread)
class ChatThreadAdmin(admin.ModelAdmin):
    list_display = ['id', 'wholesaler', 'buyer', 'updated_at']


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ['thread', 'sender', 'sent_at', 'is_read']


from .models import Device, PairingCode, DeviceScan, DeviceReading


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ['id', 'name', 'mac', 'operator_id', 'ip', 'last_seen', 'crop_type', 'product_id']
    readonly_fields = ['device_token']


@admin.register(PairingCode)
class PairingCodeAdmin(admin.ModelAdmin):
    list_display = ['code', 'operator_id', 'expires_at', 'device']


@admin.register(DeviceScan)
class DeviceScanAdmin(admin.ModelAdmin):
    list_display = ['id', 'device', 'source', 'crop_type', 'state', 'ml_confidence', 'created_at']


@admin.register(DeviceReading)
class DeviceReadingAdmin(admin.ModelAdmin):
    list_display = ['id', 'device', 'temperature_c', 'humidity_rh', 'created_at']
