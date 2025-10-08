// App.jsx (or App.tsx)
import { useState } from 'react'
import './App.css'
import { WalletClient, P2PKH, Utils } from '@bsv/sdk'

const wallet = new WalletClient()

function App() {
  const [addr, setAddr] = useState('')
  const [amt, setAmt] = useState('')
  const [atom, setAtom] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [copied, setCopied] = useState<null | 'atom' | 'addr'>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async () => {
    setIsSending(true)
    setError(null)
    try {
      const { tx } = await wallet.createAction({
        description: 'Fund',
        outputs: [{
          outputDescription: 'Fund',
          lockingScript: new P2PKH().lock(addr).toHex(),
          satoshis: Number(amt)
        }]
      })
      setAtom(Utils.toHex(tx as number[]))
    } catch (e: any) {
      setError(e?.message || 'Failed to create action.')
    } finally {
      setIsSending(false)
    }
  }

  const copy = async (what: 'atom' | 'addr') => {
    const text = what === 'atom' ? atom : addr
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1200)
    } catch { /* noop */ }
  }

  const canSend = !!addr && !!amt && !isSending

  return (
    <div className="app-root">
      <div className="card">
        <h1 className="title">Funder</h1>

        <label className="label">
          Address
          <div className="row">
            <input
              className="input wide"
              placeholder="Enter an address..."
              type="text"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
            />
            <button
              className="ghost"
              onClick={() => copy('addr')}
              title="Copy address"
              disabled={!addr}
            >
              {copied === 'addr' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </label>

        <label className="label">
          Amount (satoshis)
          <input
            className="input"
            placeholder="Amount (satoshis)"
            type="number"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            min={0}
          />
        </label>

        <button
          className={`primary ${!canSend ? 'disabled' : ''}`}
          onClick={handleSend}
          disabled={!canSend}
        >
          {isSending ? (
            <span className="spinner-wrap">
              <span className="spinner" /> Sending…
            </span>
          ) : (
            'Send'
          )}
        </button>

        {error && <p className="error">{error}</p>}

        <div className="output">
          <div className="output-head">
            <span>Atomic BEEF</span>
            <button
              className="ghost"
              onClick={() => copy('atom')}
              disabled={!atom}
              title="Copy Atomic BEEF"
            >
              {copied === 'atom' ? '✓ Copied' : 'Copy'}
            </button>
          </div>

          {/* Rectangle container with wrapping + scroll if needed */}
          <pre className="atom-box">
            {atom || '— nothing yet —'}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default App
