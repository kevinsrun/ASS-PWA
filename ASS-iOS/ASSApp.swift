import SwiftUI

@main struct ASSApp: App {
    @StateObject private var session = SessionStore()
    var body: some Scene { WindowGroup { RootView().environmentObject(session) } }
}

struct RootView: View {
    @EnvironmentObject var session: SessionStore
    var body: some View {
        Group { if session.accessToken == nil { LoginView() } else { MainTabs() } }
            .task { await session.restore() }
    }
}
