/**
 * ThreadComposer.tsx — Message composer with asset attachment
 *
 * Text input + send. Asset attachment: link URL or local file reference.
 * Assets stored in assetsMap, referenced by messageId.
 * Phase 3: messages written locally only.
 */

import { useState, useRef, useCallback } from 'react'
import { sendMessage, addAsset, generateId, type AssetEntry } from '../../store/ydoc'
import { useIdentity } from '../../hooks/useYjs'

interface ThreadComposerProps {
  contactId: string
  onSent?: () => void
}

type AttachmentMode = null | 'link' | 'file'

export function ThreadComposer({ contactId, onSent }: ThreadComposerProps) {
  const identity = useIdentity()
  const [content, setContent] = useState('')
  const [attachMode, setAttachMode] = useState<AttachmentMode>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    if (!identity || !content.trim()) return
    setSending(true)

    let assetRef: string | undefined

    // Create asset if attachment present
    if (attachMode === 'link' && linkUrl.trim()) {
      assetRef = generateId()
      const asset: AssetEntry = {
        type: 'link',
        url: linkUrl.trim(),
        title: linkTitle.trim() || linkUrl.trim(),
        sharedInThread: contactId,
        sharedAt: new Date().toISOString(),
      }
      addAsset(assetRef, asset)
    }

    sendMessage(contactId, identity.handle, content.trim(), assetRef)

    setContent('')
    setLinkUrl('')
    setLinkTitle('')
    setAttachMode(null)
    setSending(false)
    onSent?.()
    textareaRef.current?.focus()
  }, [identity, content, attachMode, linkUrl, linkTitle, contactId, onSent])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-gray-800 bg-gray-950 flex-shrink-0">
      {/* Link attachment form */}
      {attachMode === 'link' && (
        <div className="px-4 pt-3 space-y-2">
          <input
            type="url"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            placeholder="https://..."
            className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 transition"
          />
          <input
            type="text"
            value={linkTitle}
            onChange={e => setLinkTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 transition"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setAttachMode(null); setLinkUrl(''); setLinkTitle('') }}
              className="text-gray-500 hover:text-gray-300 text-xs transition"
            >
              Cancel
            </button>
            <button
              onClick={() => setAttachMode(null)}
              disabled={!linkUrl.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs px-3 py-1.5 rounded-lg transition"
            >
              Attach
            </button>
          </div>
        </div>
      )}

      {/* Attached link preview */}
      {attachMode === null && linkUrl && (
        <div className="px-4 pt-3">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between">
            <p className="text-indigo-400 text-xs truncate">→ {linkTitle || linkUrl}</p>
            <button
              onClick={() => { setLinkUrl(''); setLinkTitle('') }}
              className="text-gray-600 hover:text-gray-400 text-xs ml-2 flex-shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Composer row */}
      <div className="flex items-end gap-2 px-4 py-3">
        {/* Attach button */}
        <button
          onClick={() => setAttachMode(attachMode === 'link' ? null : 'link')}
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition text-sm ${
            attachMode === 'link' || linkUrl
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-500 hover:text-gray-300'
          }`}
          title="Attach link"
        >
          →
        </button>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message..."
          maxLength={2000}
          rows={1}
          className="flex-1 bg-gray-800 border border-gray-700 text-white text-sm rounded-2xl px-4 py-2 focus:outline-none focus:border-indigo-500 resize-none transition leading-5"
          style={{ minHeight: '36px', maxHeight: '120px' }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={sending || !content.trim()}
          className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition"
        >
          <span className="text-xs">↑</span>
        </button>
      </div>

      <p className="text-center text-gray-700 text-xs pb-2">
        Stored locally · syncs on connection
      </p>
    </div>
  )
}
