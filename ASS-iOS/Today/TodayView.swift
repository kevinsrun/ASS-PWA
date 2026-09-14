import SwiftUI

struct TodayView: View {
    @EnvironmentObject var session: SessionStore
    @State private var state: Bootstrap?
    @State private var error: String?
    var body: some View { NavigationStack { List { if let state { Section("Next") { ForEach(state.todayEvents) { event in VStack(alignment: .leading) { Text(event.title); Text("\(event.startLabel)–\(event.endLabel)").font(.caption).foregroundStyle(.secondary) } } }; Section("Tasks") { ForEach(state.tasks.prefix(5)) { Text($0.title) } } } else if let error { ContentUnavailableView("Couldn’t load Today", systemImage: "wifi.exclamationmark", description: Text(error)) } else { ProgressView() } }.navigationTitle("Today").task { await load() } } }
    private func load() async { guard let token = session.accessToken, let base = Bundle.main.object(forInfoDictionaryKey: "ASS_API_BASE_URL") as? String, let url = URL(string: base) else { return }; do { state = try await APIClient(baseURL: url, token: token).get("api/mobile/bootstrap") } catch { self.error = error.localizedDescription } }
}
