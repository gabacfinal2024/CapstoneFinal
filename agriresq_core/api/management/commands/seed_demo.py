from decimal import Decimal
from datetime import date, timedelta
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils import timezone
from api.models import (
    UserProfile, WholesalerProfile, RescueBuyerProfile,
    IoTNode, CropBatch, SensorLog, MarketplaceListing,
)


class Command(BaseCommand):
    help = 'Seed demo data for AgriResQ development'

    def handle(self, *args, **options):
        wholesaler_user, created = User.objects.get_or_create(
            username='wholesaler1',
            defaults={
                'email': 'wholesaler@agriresq.ph',
                'first_name': 'Juan',
                'last_name': 'Vendor',
            },
        )
        if created:
            wholesaler_user.set_password('demo12345')
            wholesaler_user.save()

        UserProfile.objects.get_or_create(
            user=wholesaler_user,
            defaults={'role': 'WHOLESALER', 'phone_number': '09171234567'},
        )
        wp, _ = WholesalerProfile.objects.get_or_create(
            user=wholesaler_user,
            defaults={'stall_number': 'Stall 1', 'is_verified': True},
        )

        buyer_user, created = User.objects.get_or_create(
            username='buyer1',
            defaults={
                'email': 'buyer@agriresq.ph',
                'first_name': 'Maria',
                'last_name': 'Rescuer',
            },
        )
        if created:
            buyer_user.set_password('demo12345')
            buyer_user.save()

        UserProfile.objects.get_or_create(
            user=buyer_user,
            defaults={'role': 'RESCUE_BUYER', 'phone_number': '09189876543'},
        )
        RescueBuyerProfile.objects.get_or_create(user=buyer_user)

        node, _ = IoTNode.objects.get_or_create(
            wholesaler=wp,
            stall_location='Stall 1 - Bulua WBIT',
            defaults={'device_token': IoTNode.generate_token(), 'is_active': True},
        )

        batches_data = [
            ('EGGPLANT', Decimal('45'), Decimal('35'), 'GREEN', Decimal('4.5'), 88),
            ('CUCUMBER', Decimal('30'), Decimal('28'), 'AMBER', Decimal('2.1'), 52),
            ('CARROT', Decimal('20'), Decimal('42'), 'GREEN', Decimal('5.8'), 95),
        ]

        for crop, qty, price, status, shelf, pct in batches_data:
            batch, created = CropBatch.objects.get_or_create(
                wholesaler=wp,
                crop_type=crop,
                defaults={
                    'quantity_kg': qty,
                    'price_per_kg': price,
                    'freshness_status': status,
                    'predicted_shelf_life': shelf,
                    'freshness_percent': pct,
                    'harvest_date': date.today() - timedelta(days=1),
                    'iot_node': node,
                    'is_listed': status == 'AMBER',
                    'notes': f'Fresh {crop.lower()} from Bulua Westbound Terminal.',
                },
            )
            if created:
                SensorLog.objects.create(
                    iot_node=node,
                    crop_batch=batch,
                    temperature_c=Decimal('33.2'),
                    humidity_rh=Decimal('62'),
                    ethylene_ppm=Decimal('1.42'),
                )
                if status == 'AMBER':
                    MarketplaceListing.objects.get_or_create(
                        crop_batch=batch,
                        defaults={
                            'wholesaler': wp,
                            'listed_price': batch.total_price * Decimal('0.7'),
                            'expires_at': timezone.now() + timedelta(days=2),
                        },
                    )

        self.stdout.write(self.style.SUCCESS(
            f'Demo data seeded.\n'
            f'Wholesaler: wholesaler@agriresq.ph / demo12345\n'
            f'Buyer: buyer@agriresq.ph / demo12345\n'
            f'IoT Device Token: {node.device_token}'
        ))
