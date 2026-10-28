import secrets
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


class UserProfile(models.Model):
    ROLE_CHOICES = [
        ('WHOLESALER', 'Wholesaler'),
        ('RESCUE_BUYER', 'Rescue Buyer'),
        ('ADMIN', 'Administrator'),
    ]
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    phone_number = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} ({self.role})"


class WholesalerProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='wholesaler_profile')
    stall_number = models.CharField(max_length=50)
    market_location = models.CharField(max_length=255, default="Bulua WBIT Terminal")
    is_verified = models.BooleanField(default=False)
    rating = models.DecimalField(max_digits=3, decimal_places=2, default=5.0)
    note = models.TextField(blank=True)

    def __str__(self):
        return f"{self.user.get_full_name() or self.user.username} - Stall {self.stall_number}"


class RescueBuyerProfile(models.Model):
    BUYER_TYPE_CHOICES = [
        ('RETAILER', 'Secondary Retailer'),
        ('PROCESSOR', 'Food Processor'),
        ('CONSUMER', 'Bulk Consumer'),
    ]
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='buyer_profile')
    buyer_type = models.CharField(max_length=20, choices=BUYER_TYPE_CHOICES, default='RETAILER')
    address = models.TextField(blank=True)

    def __str__(self):
        return f"{self.user.username} ({self.buyer_type})"


class IoTNode(models.Model):
    wholesaler = models.ForeignKey(WholesalerProfile, on_delete=models.CASCADE, related_name='nodes')
    device_token = models.CharField(max_length=64, unique=True)
    stall_location = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    battery_level = models.IntegerField(default=100)
    last_seen = models.DateTimeField(null=True, blank=True)

    @staticmethod
    def generate_token():
        return secrets.token_urlsafe(32)

    def __str__(self):
        return f"Node {self.id} ({self.stall_location})"


class CropBatch(models.Model):
    CROP_CHOICES = [
        ('EGGPLANT', 'Eggplant'),
        ('CUCUMBER', 'Cucumber'),
        ('CARROT', 'Carrot'),
    ]
    STATUS_CHOICES = [
        ('GREEN', 'Fresh'),
        ('AMBER', 'At-Risk'),
        ('RED', 'Rotten'),
    ]

    wholesaler = models.ForeignKey(WholesalerProfile, on_delete=models.CASCADE, related_name='batches')
    iot_node = models.ForeignKey(IoTNode, on_delete=models.SET_NULL, null=True, blank=True)
    crop_type = models.CharField(max_length=20, choices=CROP_CHOICES)
    quantity_kg = models.DecimalField(max_digits=6, decimal_places=2)
    price_per_kg = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    freshness_status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='GREEN')
    predicted_shelf_life = models.DecimalField(max_digits=5, decimal_places=2, default=5.0)
    freshness_percent = models.IntegerField(default=100)
    harvest_date = models.DateField(null=True, blank=True)
    arrival_time = models.DateTimeField(default=timezone.now)
    image_url = models.URLField(blank=True)
    notes = models.TextField(blank=True)
    pickup_location = models.CharField(max_length=255, default="Bulua West Terminal")
    is_listed = models.BooleanField(default=False)

    @property
    def total_price(self):
        return self.quantity_kg * self.price_per_kg

    def __str__(self):
        return f"{self.crop_type} Batch #{self.id} ({self.freshness_status})"


class SensorLog(models.Model):
    iot_node = models.ForeignKey(IoTNode, on_delete=models.CASCADE, related_name='logs')
    crop_batch = models.ForeignKey(CropBatch, on_delete=models.CASCADE, related_name='sensor_logs', null=True, blank=True)
    temperature_c = models.DecimalField(max_digits=5, decimal_places=2)
    humidity_rh = models.DecimalField(max_digits=5, decimal_places=2)
    ethylene_ppm = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True)
    vpd_value = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    timestamp = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"Log {self.id} - Node {self.iot_node_id} at {self.timestamp}"


class SpoilagePrediction(models.Model):
    crop_batch = models.ForeignKey(CropBatch, on_delete=models.CASCADE, related_name='predictions')
    sensor_log = models.ForeignKey(SensorLog, on_delete=models.SET_NULL, null=True, blank=True)
    predicted_status = models.CharField(max_length=10, choices=CropBatch.STATUS_CHOICES)
    days_to_spoil = models.DecimalField(max_digits=5, decimal_places=2)
    chu_accumulated = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Prediction for Batch {self.crop_batch_id}: {self.predicted_status}"


class MarketplaceListing(models.Model):
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('SOLD', 'Sold'),
        ('EXPIRED', 'Expired'),
        ('CANCELLED', 'Cancelled'),
    ]
    crop_batch = models.OneToOneField(CropBatch, on_delete=models.CASCADE, related_name='listing')
    wholesaler = models.ForeignKey(WholesalerProfile, on_delete=models.CASCADE, related_name='listings')
    listed_price = models.DecimalField(max_digits=10, decimal_places=2)
    listing_status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Listing #{self.id} - {self.crop_batch.crop_type}"


class PushNotification(models.Model):
    TYPE_CHOICES = [
        ('STATUS_CHANGE', 'Status Change'),
        ('IOT_ALERT', 'IoT Alert'),
        ('ORDER_UPDATE', 'Order Update'),
        ('NEW_MESSAGE', 'New Message'),
        ('MARKETPLACE', 'Marketplace'),
    ]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    crop_batch = models.ForeignKey(CropBatch, on_delete=models.CASCADE, null=True, blank=True)
    notification_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    title = models.CharField(max_length=200)
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    is_acknowledged = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.notification_type}: {self.title}"


class ChatThread(models.Model):
    listing = models.ForeignKey(MarketplaceListing, on_delete=models.CASCADE, related_name='threads')
    wholesaler = models.ForeignKey(User, on_delete=models.CASCADE, related_name='seller_threads')
    buyer = models.ForeignKey(User, on_delete=models.CASCADE, related_name='buyer_threads')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['listing', 'buyer']

    def __str__(self):
        return f"Chat: {self.wholesaler.username} <-> {self.buyer.username}"


class ChatMessage(models.Model):
    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE)
    message_text = models.TextField()
    sent_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ['sent_at']

    def __str__(self):
        return f"Msg from {self.sender.username} at {self.sent_at}"


# ── Smart-home style ESP32-CAM devices (see docs/IOT_DEVICE_API.md) ──────────
# Owners are Supabase users (profiles.id UUID), not Django users: the web and
# mobile apps authenticate with Supabase, and Django is the IoT/ML hub.

CROP_TYPES = [('EGGPLANT', 'Eggplant'), ('CUCUMBER', 'Cucumber'), ('CARROT', 'Carrot')]


class Device(models.Model):
    COMMANDS = ['scan_now', 'scan_auto', 'reboot', 'forget_wifi', 'unpair']
    DEFAULT_CAPTURE_TIMES = ['07:00', '12:00', '16:00']      # Table 9: morning baseline, peak heat, end of day

    KINDS = [('CAMERA', 'Camera'), ('SENSOR', 'Sensor node')]
    kind = models.CharField(max_length=10, choices=KINDS, default='CAMERA')    # SENSOR = plain ESP32 + DHT22, no camera

    operator_id = models.CharField(max_length=64, db_index=True)
    name = models.CharField(max_length=100, default='Stall Camera')
    stall_location = models.CharField(max_length=100, blank=True)
    device_token = models.CharField(max_length=64, unique=True)
    mac = models.CharField(max_length=17, unique=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    fw_version = models.CharField(max_length=32, blank=True)
    wifi_ssid = models.CharField(max_length=64, blank=True)
    rssi = models.IntegerField(null=True, blank=True)
    uptime_s = models.IntegerField(default=0)
    last_seen = models.DateTimeField(null=True, blank=True)

    # settings the operator controls from the app; sent to the device in every heartbeat
    crop_type = models.CharField(max_length=20, choices=CROP_TYPES, default='EGGPLANT')
    product_id = models.BigIntegerField(null=True, blank=True)   # Supabase products.id
    auto_scan = models.BooleanField(default=True)                # monitoring on/off
    scan_mode = models.CharField(max_length=10, default='schedule')   # 'schedule' (capture windows) | 'interval'
    capture_times = models.JSONField(default=list)               # ["07:00","12:00","16:00"], local time
    last_window = models.CharField(max_length=20, blank=True)    # "YYYY-MM-DD HH:MM" of the last scheduled capture
    last_emergency_at = models.DateTimeField(null=True, blank=True)
    # live rule-engine countdown (VPD / CHU, paper 3.10): days left when tracking started or the camera last
    # overrode it, and the life consumed since (kept at 6 decimals; the product row only stores 2)
    eta_start = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    life_lost = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    last_reading_at = models.DateTimeField(null=True, blank=True)
    scan_interval_s = models.PositiveIntegerField(default=300)
    dht_pin = models.IntegerField(default=-1)                    # -1 = no DHT22 attached
    flash_on_scan = models.BooleanField(default=False)

    pending_command = models.CharField(max_length=20, blank=True)
    last_alert_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    ONLINE_WINDOW_S = 30

    @staticmethod
    def generate_token():
        return secrets.token_urlsafe(32)

    def times(self):
        return self.capture_times or self.DEFAULT_CAPTURE_TIMES

    @property
    def online(self):
        return bool(self.last_seen) and (timezone.now() - self.last_seen).total_seconds() < self.ONLINE_WINDOW_S

    def config(self):
        return {
            'crop_type': self.crop_type,
            # in 'schedule' mode the server sends scan commands at the capture times itself
            'auto_scan': self.auto_scan and self.scan_mode == 'interval',
            'scan_interval_s': self.scan_interval_s,
            'dht_pin': self.dht_pin,
            'flash_on_scan': self.flash_on_scan,
            'heartbeat_s': 5,
        }

    def __str__(self):
        return f"{self.name} ({self.mac})"


class PairingCode(models.Model):
    code = models.CharField(max_length=8, unique=True)
    operator_id = models.CharField(max_length=64)
    name = models.CharField(max_length=100, blank=True)
    stall_location = models.CharField(max_length=100, blank=True)
    crop_type = models.CharField(max_length=20, choices=CROP_TYPES, default='EGGPLANT')
    expires_at = models.DateTimeField()
    device = models.ForeignKey(Device, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   # no 0/O/1/I

    @classmethod
    def new_code(cls):
        while True:
            code = ''.join(secrets.choice(cls.ALPHABET) for _ in range(6))
            if not cls.objects.filter(code=code).exists():
                return code

    @property
    def status(self):
        if self.device_id:
            return 'CLAIMED'
        return 'EXPIRED' if timezone.now() > self.expires_at else 'WAITING'


class DeviceScan(models.Model):
    SOURCES = [('AUTO', 'Auto'), ('MANUAL', 'Manual'), ('UPLOAD', 'Upload')]

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name='scans', null=True, blank=True)
    source = models.CharField(max_length=10, choices=SOURCES, default='AUTO')
    crop_type = models.CharField(max_length=20, choices=CROP_TYPES)
    detected = models.BooleanField(default=True)                # False = no eggplant/cucumber/carrot in view
    detected_crop = models.CharField(max_length=20, null=True, blank=True)
    crop_mismatch = models.BooleanField(default=False)
    message = models.CharField(max_length=200, blank=True)
    none_prob = models.FloatField(default=0.0)
    state = models.CharField(max_length=10)                     # fresh / at-risk / rotten / none
    freshness_status = models.CharField(max_length=10)          # GREEN / AMBER / RED / UNKNOWN
    freshness_percent = models.IntegerField(null=True, blank=True)
    days_to_spoil = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    ml_confidence = models.FloatField()
    probs = models.JSONField(null=True, blank=True)
    low_confidence = models.BooleanField(default=False)
    image = models.CharField(max_length=255, blank=True)        # annotated JPEG under MEDIA_ROOT
    raw_image = models.CharField(max_length=255, blank=True)    # untouched camera frame (for retraining)
    feedback_label = models.CharField(max_length=40, null=True, blank=True)   # operator's correction
    product_id = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class DeviceReading(models.Model):
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name='readings')
    temperature_c = models.DecimalField(max_digits=5, decimal_places=2)
    humidity_rh = models.DecimalField(max_digits=5, decimal_places=2)
    vpd_kpa = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class BatchClock(models.Model):
    """When a Supabase batch (product) last had its countdown written. The time-based aging job
    ages a batch by the hours since then, so a batch with no camera or sensor still gets older."""
    product_id = models.BigIntegerField(unique=True)
    last_tick = models.DateTimeField()
    chu_accumulated = models.DecimalField(max_digits=12, decimal_places=3, default=0)   # degree-hours above the stress temperature since the batch was first seen


class DeviceMonitor(models.Model):
    """A second stall operator who can watch a camera (live view, scans, readings) but not change it.
    Every stall camera should have its owner plus at least one monitor."""
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name='monitors')
    user_id = models.CharField(max_length=64, db_index=True)       # Supabase profiles.id
    full_name = models.CharField(max_length=120, blank=True)
    email = models.CharField(max_length=190, blank=True)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('device', 'user_id')]
        ordering = ['added_at']
