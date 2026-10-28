from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from .models import IoTNode


class IoTDeviceAuthentication(BaseAuthentication):
    """Authenticate ESP32 nodes via X-Device-Token header."""

    def authenticate(self, request):
        token = request.META.get('HTTP_X_DEVICE_TOKEN')
        if not token:
            return None
        try:
            node = IoTNode.objects.select_related('wholesaler').get(
                device_token=token, is_active=True
            )
        except IoTNode.DoesNotExist:
            raise AuthenticationFailed('Invalid or inactive device token.')
        return (node.wholesaler.user, node)
