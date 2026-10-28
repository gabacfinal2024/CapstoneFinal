from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsWholesaler(BasePermission):
    def has_permission(self, request, view):
        profile = getattr(request.user, 'profile', None)
        return profile and profile.role == 'WHOLESALER'


class IsRescueBuyer(BasePermission):
    def has_permission(self, request, view):
        profile = getattr(request.user, 'profile', None)
        return profile and profile.role == 'RESCUE_BUYER'


class IsAdminUser(BasePermission):
    def has_permission(self, request, view):
        profile = getattr(request.user, 'profile', None)
        return profile and profile.role == 'ADMIN'


class IsWholesalerOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return request.user.is_authenticated
        profile = getattr(request.user, 'profile', None)
        return profile and profile.role == 'WHOLESALER'
