export interface VaultPilotSettings {
	// OpenAI
	apiKeySecretId: string;   			// e.g. "openai.vaultpilot" or whatever user created in Keychain
	openaiApiKeyFallback: string; // used only when SecretStorage/Keychain is unavailable
	model: string;                        // e.g. "gpt-4.1-mini"
	embeddingModel: string;               // e.g. "text-embedding-3-large"
	openaiBaseUrl: string;                // default https://api.openai.com

	// Indexing
	indexFolders: string[];
	excludeFolders: string[];
	maxChunkChars: number;
	overlapChars: number;
	sendExcerptsOnly: boolean;
	redactPatterns: string[];
	includeFrontmatterInIndex: boolean;

	// Templates / automation
	templatesFolder: string;              // e.g. "99_Templates"
	personTemplateFile: string;           // e.g. "Person.md" (in templatesFolder)
	meetingTemplateFile: string;          // e.g. "Meeting.md" (in templatesFolder)
	peopleFolder: string;                 // e.g. "04_People"
	meetingsFolder: string;               // e.g. "02_Meetings"

	// Behavior
	enableAutoIndexOnChange: boolean;
	enableMeetingAutomation: boolean;
	meetingAutomationTag: string;         // e.g. "#meeting"
	aiOptOutFrontmatterKey: string;       // default "ai"
}

export const DEFAULT_SETTINGS: VaultPilotSettings = {
	apiKeySecretId: "vaultpilot.openai_api_key",
	openaiApiKeyFallback: "",
	model: "gpt-4.1-mini",
	embeddingModel: "text-embedding-3-large",
	openaiBaseUrl: "https://api.openai.com",

	indexFolders: ["04_People", "02_Meetings", "Projects"],
	excludeFolders: [".obsidian", "99_Templates"],
	maxChunkChars: 2400,
	overlapChars: 250,
	sendExcerptsOnly: true,
	redactPatterns: [
		"(?i)api[_-]?key\\s*[:=]\\s*\\S+",
		"(?i)password\\s*[:=]\\s*\\S+",
		"(?i)secret\\s*[:=]\\s*\\S+"
	],
	includeFrontmatterInIndex: true,

	templatesFolder: "99_Templates",
	personTemplateFile: "Person.md",
	meetingTemplateFile: "Meeting.md",
	peopleFolder: "04_People",
	meetingsFolder: "02_Meetings",

	enableAutoIndexOnChange: true,
	enableMeetingAutomation: true,
	meetingAutomationTag: "#meeting",
	aiOptOutFrontmatterKey: "ai"
};
