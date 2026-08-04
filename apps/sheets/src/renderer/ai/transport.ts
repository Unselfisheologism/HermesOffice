import { createIpcTransport, type AgentTransport } from '@hermesoffice/agent-core'
import type { AiSettings } from '@hermesoffice/ai-provider'
import { t } from '../i18n/locale'

/** The shared IPC transport wired to the sheets preload bridge (window.desktopApi). */
export function createElectronTransport(getSettings: () => AiSettings): AgentTransport {
  return createIpcTransport<AiSettings>({
    onStream: (listener) => window.desktopApi.onAiStream(listener),
    start: (request) => void window.desktopApi.aiStream(request),
    cancel: (requestId) => void window.desktopApi.aiStreamCancel(requestId),
    getSettings,
    unknownErrorText: () => t('aiUnknownError'),
  })
}
