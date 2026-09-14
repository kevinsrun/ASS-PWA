# ASS iOS

Native SwiftUI client scaffold. Create an iOS app target named `ASS` in Xcode, add the files in this folder, then add the Supabase Swift package. Configure `ASS_API_BASE_URL` and Supabase public URL/key in an uncommitted `.xcconfig`; never add a service-role key to iOS.

Google app sign-in uses Supabase Auth's native Google ID-token flow. Gmail, Calendar, and Drive remain separate connected-account permissions handled by the ASS backend.
