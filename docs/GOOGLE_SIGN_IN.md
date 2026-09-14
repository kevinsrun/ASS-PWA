# Google app sign-in

Google app authentication is separate from the Gmail, Calendar, and Drive connected-account consent flow.

1. In Google Cloud, create a Web OAuth client with the app's local and production origins.
2. Add the Supabase callback URI shown under **Supabase → Authentication → Providers → Google** to that client's authorized redirect URIs.
3. Enable the Google provider in Supabase and paste its client ID and secret there.
4. Add `http://localhost:3000/**` and the production Vercel URL to **Supabase → Authentication → URL Configuration → Redirect URLs**. Set the deployed app as the Site URL in production.
5. Keep `NEXT_PUBLIC_SUPABASE_URL` and the publishable key in local/Vercel environments. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser or iOS app.

The separate Google data connection still uses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `NEXT_PUBLIC_APP_URL`, and requests Gmail/Calendar/Drive scopes after app sign-in.

For native iOS, create a Google iOS OAuth client for the final bundle identifier, add both Web and iOS client IDs to the Supabase Google provider, and exchange the Google ID token through Supabase Auth.
