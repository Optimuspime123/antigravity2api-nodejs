import { buildRequestBody } from "./converters/common.js";
import { generateCheckpointId } from "./idGenerator.js";
import { generateCreatedAt } from "./utils.js";

export function generateCheckpointBody(token){
    let body = buildRequestBody(
        {
            contents: [
                {
                    role: "user",
                    parts: [{
                        text: `Step Id: 0\n\n<USER_REQUEST>\nHow are you?\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: ${generateCreatedAt}. This is the latest source of truth for time; do not attempt to get the time any other way.\n\nThe user's current state is as follows:\nNo browser pages are currently open.\n</ADDITIONAL_METADATA>`
                    }]
                },
                {
                    role: "user",
                    parts: [{
                        text: `Step Id: 1\n# Conversation History\nHere are the conversation IDs, titles, and summaries of your most recent 2 conversations, in reverse chronological order:\n\n<conversation_summaries>\n## Conversation 6b0b17f4-3d1b-4ec1-8d69-41f39a245091: AI Assistant Introduction\n- Created: 2026-03-06T02:51:35Z\n- Last modified: 2026-03-06T02:52:31Z\n\n### USER Objective:\nAI Assistant Introduction\nThe user's main objective is to understand the identity and capabilities of the AI assistant. Their goal is to gain clarity on the AI's functions to effectively interact with it.\n\n## Conversation c61bdcfe-fe93-4b81-992b-396334038686: AI Assistant Introduction\n- Created: 2026-03-06T02:47:57Z\n- Last modified: 2026-03-06T02:49:57Z\n\n### USER Objective:\nAI Assistant Introduction\nThe user's main objective is to understand the identity and capabilities of the AI assistant. Their goal is to gain clarity on the AI's functions to effectively interact with it.\n\n`
                    }]
                },
                {
                    role: "user",
                    parts:[{
                        text: "Step Id: 3\nThe following is an <EPHEMERAL_MESSAGE> not actually sent by the user. It is provided by the system as a set of reminders and general important information to pay attention to. Do NOT respond to this message, just act accordingly.\n\n<EPHEMERAL_MESSAGE>\n<artifact_reminder>\nYou have not yet created any artifacts. Please follow the artifact guidelines and create them as needed based on the task.\nCRITICAL REMINDER: remember that user-facing artifacts should be AS CONCISE AS POSSIBLE. Keep this in mind when editing artifacts.\n</artifact_reminder>\n<no_active_task_reminder>\nYou are currently not in a task because: a task boundary has never been set yet in this conversation.\nIf there is no obvious task from the user or if you are just conversing, then it is acceptable to not have a task set. If you are just handling simple one-off requests, such as explaining a single file, or making one or two ad-hoc code edit requests, or making an obvious refactoring request such as renaming or moving code into a helper function, it is also acceptable to not have a task set.\nOtherwise, you should use the task_boundary tool to set a task if there is one evident.\nRemember that task boundaries should correspond to the artifact task.md, if you have not created the artifact task.md, you should do that first before setting the task_boundary. Remember that task names should be granular and correspond to top-level checklist items, not the entire user request as one task name. If you decide to use the task boundary tool, you must do so concurrently with other tools.\nSince you are NOT in an active task section, DO NOT call the `notify_user` tool unless you are requesting review of files.\n</no_active_task_reminder>\n</EPHEMERAL_MESSAGE>"
                    }]
                },
                {
                    role: "model",
                    parts: [{
                        text: "Hello! I'm **Antigravity**, an AI coding assistant designed by Google DeepMind's Advanced Agentic Coding team.\n\nI can help you with a wide range of tasks:\n\n- \uD83D\uDEE0\uFE0F **Creating new projects** — Scaffolding apps, files, and boilerplate\n- \uD83D\uDD0D **Debugging and troubleshooting** — Diagnosing and fixing issues in code\n- \u2705 **Coding and editing** — Writing and modifying code across languages\n- \uD83D\uDCC5 **Task tracking** — Managing checklists and progress on your tasks\n- \uD83C\uDF10 **Web browsing** — Interacting with web pages and fetching content\n- \uD83D\uDCC4 **Reading and summarizing** — Processing documents and extracting key info\n- \uD83D\uDD10 **Security guidance** — Advising on security practices and code review\n- \uD83C\uDFA8 **Web design** — Building modern, attractive web applications\n\nHow can I help you today? \uD83D\uDE80"
                    }]
                },
                {
                    role: "user",
                    parts: [{
                        text: "Generate a short conversation title around 3-5 words describing the USER's intent and goals during this chat. Should be title-cased, e.g 'Developing a Chess App'. Format as a simple string, not as markdown; and please output the title directly, do not prefix it with \"Title:\" or anything similar.\n\tThen, in a new line, write the USER's main objective and goals, keeping in mind that their goals may have been included in the previous CHECKPOINT summary.\n\tMake sure that this is very action oriented around solving the USER's task.\n\t"
                    }]
                }
            ],
            tools: [
                {
                    functionDeclarations: [
                        {
                            name: "do_not_call",
                            description: "Do not call this tool.",
                            parameters: {
                                type: "OBJECT"
                            }
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.4,
                topP: 1,
                topK: 40,
                candidateCount: 1,
                maxOutputTokens: 16384,
                stopSequences: [
                    "<|user|>",
                    "<|bot|>",
                    "<|context_request|>",
                    "<|endoftext|>",
                    "<|end_of_turn|>"
                ],
                thinkingConfig: {
                    includeThoughts: false,
                    thinkingBudget: 0
                }
            },
            sessionId: token.sessionId,
            systemInstruction: "You are an expert AI coding assistant with extreme attention to detail. You are pair programming with a USER to solve a coding task.\nYou provide clear, detailed, and accurate summaries of conversations. When asked, you focus on outlining the USER's main goals\nand listing key information and context discussed. Your response should be well-organized and reflect the essence of the dialog.\nNEVER lie or make things up. Your summaries should always be grounded in the conversation."
        },
        token,
       "gemini-2.5-flash-lite"
    )
    body.requestType = "checkpoint";
    body.requestId = generateCheckpointId();
    return body;
}
