import { useState, useRef } from 'react'

const MAX_WIDTH = 1200
const JPEG_QUALITY = 0.85

function resizeToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (ev) => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        let w = img.width
        let h = img.height
        if (w > MAX_WIDTH) {
          h = Math.round((h * MAX_WIDTH) / w)
          w = MAX_WIDTH
        }
        const canvas = document.createElement('canvas')
        canvas.width  = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  })
}

export default function ImageUploader({ value, onChange }) {
  const [tab, setTab]     = useState(value?.startsWith('http') ? 'url' : 'upload')
  const [url, setUrl]     = useState(value?.startsWith('http') ? value : '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  const hasImage = Boolean(value)

  async function handleFile(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('El archivo debe ser una imagen.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const dataUrl = await resizeToDataUrl(file)
      onChange(dataUrl)
    } catch {
      setError('No se pudo procesar la imagen.')
    } finally {
      setLoading(false)
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function applyUrl() {
    if (!url.trim()) return
    onChange(url.trim())
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Current image preview */}
      {hasImage && (
        <div className="relative rounded-card overflow-hidden border border-border group">
          <img
            src={value}
            alt="Portada del artículo"
            className="w-full h-40 object-cover"
            onError={() => { setError('La imagen no se pudo cargar.'); onChange('') }}
          />
          <button
            type="button"
            onClick={() => { onChange(''); setUrl('') }}
            className="absolute top-2 right-2 w-7 h-7 bg-black/60 text-white rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            aria-label="Eliminar imagen"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Tab selector */}
      <div className="flex rounded-sm border border-border overflow-hidden text-sm">
        {['upload', 'url'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              'flex-1 min-h-[36px] font-mono text-label uppercase tracking-widest transition-colors duration-150',
              tab === t ? 'bg-primary text-white' : 'text-ink-secondary hover:bg-surface',
            ].join(' ')}
          >
            {t === 'upload' ? 'Subir archivo' : 'URL'}
          </button>
        ))}
      </div>

      {/* Upload tab */}
      {tab === 'upload' && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
          aria-label="Área de carga de imagen"
          className="border-2 border-dashed border-border rounded-card p-6 text-center cursor-pointer hover:border-primary hover:bg-primary-50 transition-colors duration-150 focus-visible:rounded-card"
        >
          {loading ? (
            <p className="font-body text-body-sm text-ink-secondary">Procesando imagen…</p>
          ) : (
            <>
              <svg className="mx-auto mb-2 text-ink-secondary" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <p className="font-body text-body-sm text-ink-secondary">
                Arrastrá una imagen o <span className="text-primary underline">buscá en tu equipo</span>
              </p>
              <p className="font-mono text-label text-border mt-1">JPG, PNG, WEBP · máx. recomendado 4 MB</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>
      )}

      {/* URL tab */}
      {tab === 'url' && (
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyUrl() } }}
            placeholder="https://…"
            className="flex-1 min-h-[44px] px-3 py-2 border border-border rounded-sm font-body text-body text-ink-primary bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
          <button
            type="button"
            onClick={applyUrl}
            disabled={!url.trim()}
            className="min-h-[44px] px-4 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 disabled:opacity-50 transition-colors duration-150"
          >
            Aplicar
          </button>
        </div>
      )}

      {error && (
        <p className="font-body text-body-sm text-red-600">{error}</p>
      )}

      {!hasImage && (
        <p className="font-mono text-label text-ink-secondary">
          Sin imagen: se usará el color de portada seleccionado.
        </p>
      )}
    </div>
  )
}
