import Foundation
import Security

@MainActor final class SessionStore: ObservableObject {
    @Published var accessToken: String?
    func restore() async { accessToken = KeychainStore.read("ass.accessToken") }
    func setToken(_ token: String) { KeychainStore.write(token, key: "ass.accessToken"); accessToken = token }
    func signOut() { KeychainStore.delete("ass.accessToken"); accessToken = nil }
}

enum KeychainStore {
    static func read(_ key: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key, kSecReturnData as String: true]
        var result: AnyObject?; guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func write(_ value: String, key: String) {
        delete(key); let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key, kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        SecItemAdd(query as CFDictionary, nil)
    }
    static func delete(_ key: String) { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key] as CFDictionary) }
}
