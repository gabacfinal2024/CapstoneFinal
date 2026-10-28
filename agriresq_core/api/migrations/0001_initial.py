# Generated manually for AgriResQ

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='UserProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(choices=[('WHOLESALER', 'Wholesaler'), ('RESCUE_BUYER', 'Rescue Buyer'), ('ADMIN', 'Administrator')], max_length=20)),
                ('phone_number', models.CharField(blank=True, max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='profile', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='WholesalerProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('stall_number', models.CharField(max_length=50)),
                ('market_location', models.CharField(default='Bulua WBIT Terminal', max_length=255)),
                ('is_verified', models.BooleanField(default=False)),
                ('rating', models.DecimalField(decimal_places=2, default=5.0, max_digits=3)),
                ('note', models.TextField(blank=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='wholesaler_profile', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='RescueBuyerProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('buyer_type', models.CharField(choices=[('RETAILER', 'Secondary Retailer'), ('PROCESSOR', 'Food Processor'), ('CONSUMER', 'Bulk Consumer')], default='RETAILER', max_length=20)),
                ('address', models.TextField(blank=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='buyer_profile', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='IoTNode',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('device_token', models.CharField(max_length=64, unique=True)),
                ('stall_location', models.CharField(max_length=100)),
                ('is_active', models.BooleanField(default=True)),
                ('battery_level', models.IntegerField(default=100)),
                ('last_seen', models.DateTimeField(blank=True, null=True)),
                ('wholesaler', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='nodes', to='api.wholesalerprofile')),
            ],
        ),
        migrations.CreateModel(
            name='CropBatch',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('crop_type', models.CharField(choices=[('EGGPLANT', 'Eggplant'), ('CUCUMBER', 'Cucumber'), ('CARROT', 'Carrot')], max_length=20)),
                ('quantity_kg', models.DecimalField(decimal_places=2, max_digits=6)),
                ('price_per_kg', models.DecimalField(decimal_places=2, default=0, max_digits=8)),
                ('freshness_status', models.CharField(choices=[('GREEN', 'Fresh'), ('AMBER', 'At-Risk'), ('RED', 'Spoiled')], default='GREEN', max_length=10)),
                ('predicted_shelf_life', models.DecimalField(decimal_places=2, default=5.0, max_digits=5)),
                ('freshness_percent', models.IntegerField(default=100)),
                ('harvest_date', models.DateField(blank=True, null=True)),
                ('arrival_time', models.DateTimeField(default=django.utils.timezone.now)),
                ('image_url', models.URLField(blank=True)),
                ('notes', models.TextField(blank=True)),
                ('pickup_location', models.CharField(default='Bulua West Terminal', max_length=255)),
                ('is_listed', models.BooleanField(default=False)),
                ('iot_node', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='api.iotnode')),
                ('wholesaler', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='batches', to='api.wholesalerprofile')),
            ],
        ),
        migrations.CreateModel(
            name='SensorLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('temperature_c', models.DecimalField(decimal_places=2, max_digits=5)),
                ('humidity_rh', models.DecimalField(decimal_places=2, max_digits=5)),
                ('ethylene_ppm', models.DecimalField(blank=True, decimal_places=3, max_digits=6, null=True)),
                ('vpd_value', models.DecimalField(blank=True, decimal_places=4, max_digits=6, null=True)),
                ('timestamp', models.DateTimeField(default=django.utils.timezone.now)),
                ('crop_batch', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='sensor_logs', to='api.cropbatch')),
                ('iot_node', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='logs', to='api.iotnode')),
            ],
            options={'ordering': ['-timestamp']},
        ),
        migrations.CreateModel(
            name='SpoilagePrediction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('predicted_status', models.CharField(choices=[('GREEN', 'Fresh'), ('AMBER', 'At-Risk'), ('RED', 'Spoiled')], max_length=10)),
                ('days_to_spoil', models.DecimalField(decimal_places=2, max_digits=5)),
                ('chu_accumulated', models.DecimalField(decimal_places=2, default=0, max_digits=8)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('crop_batch', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='predictions', to='api.cropbatch')),
                ('sensor_log', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='api.sensorlog')),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='MarketplaceListing',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('listed_price', models.DecimalField(decimal_places=2, max_digits=10)),
                ('listing_status', models.CharField(choices=[('ACTIVE', 'Active'), ('SOLD', 'Sold'), ('EXPIRED', 'Expired'), ('CANCELLED', 'Cancelled')], default='ACTIVE', max_length=20)),
                ('expires_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('crop_batch', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='listing', to='api.cropbatch')),
                ('wholesaler', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='listings', to='api.wholesalerprofile')),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='PushNotification',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('notification_type', models.CharField(choices=[('STATUS_CHANGE', 'Status Change'), ('IOT_ALERT', 'IoT Alert'), ('ORDER_UPDATE', 'Order Update'), ('NEW_MESSAGE', 'New Message'), ('MARKETPLACE', 'Marketplace')], max_length=20)),
                ('title', models.CharField(max_length=200)),
                ('message', models.TextField()),
                ('is_read', models.BooleanField(default=False)),
                ('is_acknowledged', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('crop_batch', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, to='api.cropbatch')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='ChatThread',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('buyer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='buyer_threads', to=settings.AUTH_USER_MODEL)),
                ('listing', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='threads', to='api.marketplacelisting')),
                ('wholesaler', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='seller_threads', to=settings.AUTH_USER_MODEL)),
            ],
            options={'unique_together': {('listing', 'buyer')}},
        ),
        migrations.CreateModel(
            name='ChatMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('message_text', models.TextField()),
                ('sent_at', models.DateTimeField(auto_now_add=True)),
                ('is_read', models.BooleanField(default=False)),
                ('sender', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                ('thread', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='messages', to='api.chatthread')),
            ],
            options={'ordering': ['sent_at']},
        ),
    ]
