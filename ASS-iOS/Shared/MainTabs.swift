import SwiftUI

struct MainTabs: View {
    var body: some View { TabView { TodayView().tabItem { Label("Today", systemImage: "sun.max") }; PlaceholderView(title: "Calendar").tabItem { Label("Calendar", systemImage: "calendar") }; PlaceholderView(title: "Inbox").tabItem { Label("Inbox", systemImage: "tray") }; PlaceholderView(title: "Finance").tabItem { Label("Finance", systemImage: "chart.line.uptrend.xyaxis") }; PlaceholderView(title: "Chat").tabItem { Label("Chat", systemImage: "sparkles") }; PlaceholderView(title: "Profile").tabItem { Label("Profile", systemImage: "person.crop.circle") } } }
}
struct PlaceholderView: View { let title: String; var body: some View { NavigationStack { ContentUnavailableView(title, systemImage: "circle.grid.2x2") }.navigationTitle(title) } }
