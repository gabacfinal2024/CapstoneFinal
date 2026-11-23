from datetime import timedelta

from django.utils.dateparse import parse_datetime


LISTING_WINDOW = timedelta(hours=5)
WINDOW_CLOSED = 'This scan has expired. Run a new scan to publish a listing.'


def listing_deadline(scan):
    return scan.created_at + LISTING_WINDOW


def is_source_attachment(scan, product):
    # A later camera frame may inherit the monitored batch ID.
    return scan.source in ('PHONE', 'UPLOAD') or scan.created_at <= parse_datetime(product['created_at'])


def active_listing_ids(rows, now):
    return {
        row['product_id'] for row in rows
        if row.get('expires_at') and parse_datetime(row['expires_at']) > now
    }
