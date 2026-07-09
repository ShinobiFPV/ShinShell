import type { ShinShellApi } from './index'

declare global {
  interface Window {
    shinshell: ShinShellApi
  }
}
