from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0011_devicescan_operator_source'),
    ]

    operations = [
        migrations.AlterField(
            model_name='devicescan',
            name='device',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.SET_NULL,
                related_name='scans',
                to='api.device',
            ),
        ),
    ]
