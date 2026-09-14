import Foundation

struct Bootstrap: Decodable { let today: String; let todayEvents: [CalendarItem]; let tasks: [TaskItem]; let assistantActions: [AssistantItem] }
struct CalendarItem: Decodable, Identifiable { let localId: Int64; let title, date, startLabel, endLabel: String; var id: Int64 { localId }; let optionality: String? }
struct TaskItem: Decodable, Identifiable { let localId: Int64; let title: String; let dueDate: String?; var id: Int64 { localId } }
struct AssistantItem: Decodable, Identifiable { let id: String; let title: String; let summary: String?; let priority: String }
