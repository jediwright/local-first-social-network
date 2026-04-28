import { useState } from 'react'
import ContactList from './ContactList'
import ContactDetail from './ContactDetail'
import TrustSettings from './TrustSettings'

interface Props {
  onOpenThread: (contactId: string) => void
}

type Panel = { view: 'list' } | { view: 'detail', contactId: string } | { view: 'trust', contactId: string }

export default function ContactsView({ onOpenThread }: Props) {
  const [panel, setPanel] = useState<Panel>({ view: 'list' })

  if (panel.view === 'detail') {
    return (
      <ContactDetail
        contactId={panel.contactId}
        onBack={() => setPanel({ view: 'list' })}
        onOpenThread={(id) => {
          setPanel({ view: 'list' })
          onOpenThread(id)
        }}
        onEditTrust={(id) => setPanel({ view: 'trust', contactId: id })}
      />
    )
  }

  if (panel.view === 'trust') {
    return (
      <TrustSettings
        contactId={panel.contactId}
        onBack={() => setPanel({ view: 'detail', contactId: panel.contactId })}
        onRemoved={() => setPanel({ view: 'list' })}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Contacts</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ContactList onSelectContact={(id) => setPanel({ view: 'detail', contactId: id })} />
      </div>
    </div>
  )
}
