# Supabase email verification

The registration forms require a syntactically valid email address, send a
Supabase confirmation link, and do not grant app access until Supabase confirms
the address.

The checked-in `config.toml` enables email confirmations for local Supabase
development. For the hosted project, also enable the setting below in the
dashboard; the local config file does not change hosted project settings.

For the hosted project, enable **Authentication → Providers → Email → Confirm
email** in the Supabase dashboard and configure SMTP under **Project Settings →
Authentication → SMTP Settings**. Add each deployed app URL, plus the local and
Capacitor redirect URLs, under **Authentication → URL Configuration → Redirect
URLs**. Supabase's built-in email service is rate-limited and intended only for
testing.

If signup displays an email rate-limit error, it means Supabase is throttling
confirmation-email delivery; it does not mean the address is already in use.
Wait for the project's email quota to reset before retrying. For reliable
registration, configure a custom SMTP provider in the hosted project. Changing
the local `config.toml` cannot raise the hosted project's quota.

For an existing database, apply `002_auth_registration.sql` in the Supabase SQL
Editor. Fresh databases should use the updated `001_agriresq_schema.sql`.
