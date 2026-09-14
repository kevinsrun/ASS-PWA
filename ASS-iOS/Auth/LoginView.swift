import SwiftUI

struct LoginView: View {
    var body: some View { VStack(spacing: 16) { Spacer(); Text("ASS").font(.largeTitle.bold()); Text("Your life, quietly organized.").foregroundStyle(.secondary); Button("Continue with Google") { /* Exchange Google ID token with Supabase Auth, then store the ASS access token. */ }.buttonStyle(.borderedProminent).controlSize(.large); Spacer() }.padding(28) }
}
