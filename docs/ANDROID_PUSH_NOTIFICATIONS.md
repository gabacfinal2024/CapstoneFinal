# Android phone notifications

1. Apply [Supabase migration 018](../supabase/018_android_push_notifications.sql) before deploying the updated Django backend.
2. Register the Android app `ph.agriresq.app` in Firebase and put its `google-services.json` in `agriresq_mobile/android/app/`. Enable the Firebase Cloud Messaging API in that project. [Firebase Android setup](https://firebase.google.com/docs/cloud-messaging/android/get-started)
3. Set `AGRIRESQ_FCM_SERVICE_ACCOUNT_JSON` to the Firebase service account JSON in the backend environment. The backend also needs `SUPABASE_SERVICE_ROLE_KEY` and `AGRIRESQ_BACKGROUND=1` in production. Keep both server credentials out of the APK. The backend worker must be running to deliver alerts promptly. [FCM server authentication](https://firebase.google.com/docs/cloud-messaging/send/v1-api)
4. From `agriresq_mobile`, run `npm ci`, `npm run build`, and `npx cap sync android`, then build and install the APK. Sign in, open **Notifications**, and select **Enable phone notifications with sound** if prompted.

To verify delivery, close the app normally on two signed-in Android phones, one per role. Send the stall operator a new message, then publish an at-risk batch or move an active listing to At-Risk. The stall operator should hear the message and batch alerts. The rescue buyer should hear the listing alert. Both channels use the phone's default notification tone and follow its sound settings.
