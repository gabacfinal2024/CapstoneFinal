from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .supabase_admin import SupabaseAdminError, get_admin_profile, set_account_active
from .supabase_auth import SupabaseAuthentication, SupabaseUser


class AdminAccountStatusView(APIView):
    authentication_classes = [SupabaseAuthentication]
    permission_classes = [IsAuthenticated]

    def patch(self, request, user_id):
        if not isinstance(request.user, SupabaseUser) or request.user.role != 'ADMIN':
            return Response({'detail': 'Administrators only.'}, status=status.HTTP_403_FORBIDDEN)
        if str(request.user.id) == str(user_id):
            return Response({'detail': 'You cannot deactivate your own administrator account.'},
                            status=status.HTTP_400_BAD_REQUEST)

        is_active = request.data.get('is_active')
        if not isinstance(is_active, bool):
            return Response({'detail': 'is_active must be true or false.'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            profile = get_admin_profile(user_id)
            if profile is None:
                return Response({'detail': 'User profile not found.'}, status=status.HTTP_404_NOT_FOUND)
            if profile.get('role') == 'ADMIN':
                return Response({'detail': 'Administrator accounts cannot be deactivated here.'},
                                status=status.HTTP_400_BAD_REQUEST)
            if profile.get('is_active') is not is_active:
                set_account_active(user_id, is_active)
        except SupabaseAdminError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        return Response({'id': str(user_id), 'is_active': is_active})
