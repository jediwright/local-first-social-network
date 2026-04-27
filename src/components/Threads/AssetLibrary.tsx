/**
 * AssetLibrary.tsx — Cross-thread asset search
 *
 * Shows all assets shared across all threads.
 * Filterable by type (link, file), searchable by title/URL.
 * Sorted by most recent. Clicking a link opens it.
 */

import { useState, useMemo } from 'react'
import { useAssets } from '../../hooks/useYjs'
import type { AssetEntry } from '../../store/ydoc'

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString([], {
    month: 'short', day: 'numeric', year: 'numeric'
  })
}

interface AssetCardProps {
  assetId: string
  asset: AssetEntry
}

function AssetCard({ asset }: AssetCardProps) {
  if (asset.type === 'link' && asset.url) {
    return (
      <a
        href={asset.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition space-y-2"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-indigo-400 text-sm">→</span>
            <span className="text-gray-200 text-sm font-medium truncate">
              {asset.title ?? asset.url}
            </span>
          </div>
          <span className="text-gray-600 text-xs flex-shrink-0">link</span>
        </div>
        <p className="text-gray-500 text-xs truncate">{asset.url}</p>
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>@{asset.sharedInThread}</span>
          <span>{formatDate(asset.sharedAt)}</span>
        </div>
      </a>
    )
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm">📎</span>
          <span className="text-gray-200 text-sm font-medium truncate">
            {asset.title ?? 'Attachment'}
          </span>
        </div>
        <span className="text-gray-600 text-xs">{asset.type}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>@{asset.sharedInThread}</span>
        <span>{formatDate(asset.sharedAt)}</span>
      </div>
    </div>
  )
}

export function AssetLibrary() {
  const assets = useAssets()
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'link' | 'file'>('all')

  const filteredAssets = useMemo(() => {
    return Array.from(assets.entries())
      .filter(([, asset]) => {
        if (filterType !== 'all' && asset.type !== filterType) return false
        if (search) {
          const q = search.toLowerCase()
          return (
            asset.title?.toLowerCase().includes(q) ||
            asset.url?.toLowerCase().includes(q) ||
            asset.sharedInThread.toLowerCase().includes(q)
          )
        }
        return true
      })
      .sort((a, b) => b[1].sharedAt.localeCompare(a[1].sharedAt))
  }, [assets, search, filterType])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 space-y-3 flex-shrink-0">
        <h2 className="text-white font-medium text-sm">Asset Library</h2>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search links and files..."
          className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 transition"
        />

        {/* Type filter */}
        <div className="flex gap-2">
          {(['all', 'link', 'file'] as const).map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1 rounded-full text-xs transition ${
                filterType === type
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="text-gray-500 text-sm">
              {search || filterType !== 'all' ? 'No matching assets' : 'No assets yet'}
            </p>
            <p className="text-gray-700 text-xs">
              Links and files shared in threads appear here
            </p>
          </div>
        ) : (
          <>
            <p className="text-gray-600 text-xs">{filteredAssets.length} asset{filteredAssets.length !== 1 ? 's' : ''}</p>
            {filteredAssets.map(([assetId, asset]) => (
              <AssetCard key={assetId} assetId={assetId} asset={asset} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
