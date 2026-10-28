from decimal import Decimal
from datetime import timedelta
from django.utils import timezone
from .models import (
    CropBatch, SensorLog, SpoilagePrediction, MarketplaceListing,
    PushNotification,
)
from .spoilage_engine import predict_spoilage, freshness_percent, CROP_CONFIG


def process_sensor_reading(iot_node, batch_id, temp_c, rh, ethylene_ppm=None):
    """Ingest IoT data, run spoilage engine, update batch, trigger alerts."""
    crop_batch = None
    if batch_id:
        crop_batch = CropBatch.objects.filter(
            id=batch_id, iot_node=iot_node
        ).first()

    status, days_to_spoil, new_chu, vpd = predict_spoilage(
        crop_type=crop_batch.crop_type if crop_batch else 'EGGPLANT',
        current_shelf_life=crop_batch.predicted_shelf_life if crop_batch else Decimal('5.0'),
        temp_c=Decimal(str(temp_c)),
        rh=Decimal(str(rh)),
    )

    log = SensorLog.objects.create(
        iot_node=iot_node,
        crop_batch=crop_batch,
        temperature_c=temp_c,
        humidity_rh=rh,
        ethylene_ppm=ethylene_ppm,
        vpd_value=vpd,
    )

    iot_node.last_seen = timezone.now()
    iot_node.save(update_fields=['last_seen'])

    if not crop_batch:
        return log, None

    old_status = crop_batch.freshness_status
    baseline = CROP_CONFIG[crop_batch.crop_type]['baseline_shelf_life']
    crop_batch.predicted_shelf_life = days_to_spoil
    crop_batch.freshness_status = status
    crop_batch.freshness_percent = freshness_percent(days_to_spoil, baseline)
    crop_batch.save()

    SpoilagePrediction.objects.create(
        crop_batch=crop_batch,
        sensor_log=log,
        predicted_status=status,
        days_to_spoil=days_to_spoil,
        chu_accumulated=new_chu,
    )

    if old_status != status:
        _handle_status_change(crop_batch, old_status, status)

    if float(temp_c) > 30:
        _create_iot_alert(crop_batch, temp_c, rh)

    return log, crop_batch


def _handle_status_change(batch, old_status, new_status):
    wholesaler_user = batch.wholesaler.user
    status_labels = {'GREEN': 'Fresh', 'AMBER': 'At-Risk', 'RED': 'Rotten'}

    PushNotification.objects.create(
        user=wholesaler_user,
        crop_batch=batch,
        notification_type='STATUS_CHANGE',
        title=f'Batch Status: {status_labels[new_status]}',
        message=(
            f'Your {batch.get_crop_type_display()} batch #{batch.id} '
            f'changed from {status_labels[old_status]} to {status_labels[new_status]}. '
            f'Estimated {batch.predicted_shelf_life} days remaining.'
        ),
    )

    if new_status == 'AMBER' and not batch.is_listed:
        _auto_list_batch(batch)


def _auto_list_batch(batch):
    discount = Decimal('0.7')
    listed_price = batch.total_price * discount
    MarketplaceListing.objects.get_or_create(
        crop_batch=batch,
        defaults={
            'wholesaler': batch.wholesaler,
            'listed_price': listed_price,
            'expires_at': timezone.now() + timedelta(days=2),
        },
    )
    batch.is_listed = True
    batch.save(update_fields=['is_listed'])

    PushNotification.objects.create(
        user=batch.wholesaler.user,
        crop_batch=batch,
        notification_type='MARKETPLACE',
        title='Auto-listed in Rescue Marketplace',
        message=f'Batch #{batch.id} was auto-listed at ₱{listed_price:.2f} due to At-Risk status.',
    )


def _create_iot_alert(batch, temp_c, rh):
    PushNotification.objects.create(
        user=batch.wholesaler.user,
        crop_batch=batch,
        notification_type='IOT_ALERT',
        title='High Temperature Alert',
        message=f'Temperature spike detected: {temp_c}°C, RH {rh}%. Shelf life may accelerate.',
    )
