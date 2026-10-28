from django.urls import path, include
from rest_framework.permissions import AllowAny
from rest_framework.routers import DefaultRouter
from .views import (
    RegisterView, LoginView, LogoutView, MeView,
    SensorDataView, LogsView, DashboardView, PredictView,
    AnalyzeFreshnessView, IotAnalyzeProductView,
    CropBatchViewSet, MarketplaceViewSet, NotificationViewSet,
    ChatThreadViewSet, IoTNodeViewSet,
)
from . import device_views as dv

class PublicAPIRootRouter(DefaultRouter):
    class APIRootView(DefaultRouter.APIRootView):
        permission_classes = [AllowAny]


router = PublicAPIRootRouter()
router.register(r'inventory', CropBatchViewSet, basename='inventory')
router.register(r'batches', CropBatchViewSet, basename='batches')
router.register(r'marketplace', MarketplaceViewSet, basename='marketplace')
router.register(r'notifications', NotificationViewSet, basename='notifications')
router.register(r'chat', ChatThreadViewSet, basename='chat')
router.register(r'nodes', IoTNodeViewSet, basename='nodes')

urlpatterns = [
    path('auth/register/', RegisterView.as_view(), name='register'),
    path('auth/login/', LoginView.as_view(), name='login'),
    path('auth/logout/', LogoutView.as_view(), name='logout'),
    path('auth/me/', MeView.as_view(), name='me'),

    # Frontend-facing logs endpoint: uses the logged-in user's own auth
    # token, NOT the ESP32 X-Device-Token flow. Previously this pointed at
    # SensorDataView, which requires IoTDeviceAuthentication and always
    # returns 403 for normal user tokens since it can't find a matching
    # device token header.
    path('logs/', LogsView.as_view(), name='logs'),

    # ESP32-only endpoint: requires X-Device-Token header.
    path('sensor-data/', SensorDataView.as_view(), name='sensor-data'),

    path('dashboard/', DashboardView.as_view(), name='dashboard'),
    path('predict/<int:batch_id>/', PredictView.as_view(), name='predict'),
    path('analyze-freshness/', AnalyzeFreshnessView.as_view(), name='analyze-freshness'),
    path('iot/analyze-product/', IotAnalyzeProductView.as_view(), name='iot-analyze-product'),

    # Smart-home style ESP32-CAM devices (docs/IOT_DEVICE_API.md)
    path('devices/', dv.DeviceListView.as_view(), name='devices'),
    path('devices/pairing/', dv.PairingCreateView.as_view(), name='device-pairing'),
    path('devices/pairing/<str:code>/', dv.PairingStatusView.as_view(), name='device-pairing-status'),
    path('devices/claim/', dv.DeviceClaimView.as_view(), name='device-claim'),
    path('devices/heartbeat/', dv.DeviceHeartbeatView.as_view(), name='device-heartbeat'),
    path('devices/upload-scan/', dv.DeviceUploadScanView.as_view(), name='device-upload-scan'),
    path('devices/reading/', dv.DeviceReadingView.as_view(), name='device-reading'),
    path('devices/<int:pk>/', dv.DeviceDetailView.as_view(), name='device-detail'),
    path('devices/<int:pk>/command/', dv.DeviceCommandView.as_view(), name='device-command'),
    path('devices/<int:pk>/scan-now/', dv.DeviceScanNowView.as_view(), name='device-scan-now'),
    path('devices/<int:pk>/scans/', dv.DeviceScansView.as_view(), name='device-scans'),
    path('devices/<int:pk>/monitors/', dv.DeviceMonitorsView.as_view(), name='device-monitors'),
    path('devices/<int:pk>/monitors/<str:user_id>/', dv.DeviceMonitorDetailView.as_view(), name='device-monitor-detail'),
    path('scans/', dv.ScanGalleryView.as_view(), name='scan-gallery'),
    path('stall/conditions/', dv.StallConditionsView.as_view(), name='stall-conditions'),
    path('reference/shelf-life/', dv.ShelfLifeReferenceView.as_view(), name='shelf-life-reference'),
    path('batches/<int:product_id>/photos/', dv.BatchPhotosView.as_view(), name='batch-photos'),
    path('batches/<int:product_id>/analysis/', dv.BatchAnalysisView.as_view(), name='batch-analysis'),
    path('devices/<int:pk>/scans/<int:scan_id>/feedback/', dv.ScanFeedbackView.as_view(), name='device-scan-feedback'),
    path('devices/<int:pk>/readings/', dv.DeviceReadingsView.as_view(), name='device-readings'),
    path('devices/<int:pk>/live/', dv.DeviceLiveView.as_view(), name='device-live'),
    path('devices/<int:pk>/stream/', dv.device_stream, name='device-stream'),
    path('devices/<int:pk>/snapshot/', dv.device_snapshot, name='device-snapshot'),
    path('', include(router.urls)),
]