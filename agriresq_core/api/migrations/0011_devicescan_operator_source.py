from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0010_pairingcode_kind'),
    ]

    operations = [
        migrations.AddField(
            model_name='devicescan',
            name='operator_id',
            field=models.CharField(blank=True, db_index=True, max_length=64),
        ),
        migrations.AlterField(
            model_name='devicescan',
            name='source',
            field=models.CharField(
                choices=[('AUTO', 'Auto'), ('MANUAL', 'Manual'), ('UPLOAD', 'Upload'), ('PHONE', 'Phone camera')],
                default='AUTO',
                max_length=10,
            ),
        ),
    ]
