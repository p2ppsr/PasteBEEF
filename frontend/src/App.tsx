// App.tsx
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  WalletClient, P2PKH, Utils, PushDrop, LockingScript,
  ProtoWallet, PublicKey, Random, Transaction, type WalletProtocol
} from '@bsv/sdk'

interface Slip {
  prefix: string
  suffix: string
  used: boolean
  address: string
  memo: string
  tokenKey: string
  tokenTxid: string
  tokenOutputIndex: number
  tokenBEEF: number[]
}

const SLIP_DROP = { prefix: 0, suffix: 1, used: 2, memo: 3 }
const SLIP_PROTOCOL: WalletProtocol = [2, 'deposit slip']

const wallet = new WalletClient()
const anyone = new ProtoWallet('anyone')

type Tab = 'outgoing' | 'incoming'

function App() {
  // ----- Outgoing tab (unchanged logic)
  const [sendToAddress, setSendToAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sentAtomicBEEF, setSentAtomicBEEF] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [copied, setCopied] = useState<null | 'atom' | 'addr' | `slip-${number}`>(null)
  const [error, setError] = useState<string | null>(null)

  // ----- Incoming tab (new UI around your existing logic)
  const [depositSlips, setDepositSlips] = useState<Array<Slip>>([])
  const [newSlipMemo, setNewSlipMemo] = useState('')
  const [expandedSlipIndex, setExpandedSlipIndex] = useState<number | null>(null)
  const [incomingBEEF, setIncomingBEEF] = useState('') // text area paste per slip (bound to expanded slip)
  const [isDepositing, setIsDepositing] = useState(false)

  // ----- Global UI
  const [tab, setTab] = useState<Tab>('outgoing')

  // Load/parse existing slips from basket
  useEffect(() => {
    ;(async () => {
      try {
        const { outputs, BEEF } = await wallet.listOutputs({
          basket: 'deposit slips',
          include: 'entire transactions',
          includeCustomInstructions: true,
          limit: 1000
        })
        const parsed: Array<Slip> = []
        const { publicKey: me } = await wallet.getPublicKey({ identityKey: true })

        for (const o of outputs) {
          try {
            const [tokenTxid, tokenOutputIndex] = o.outpoint.split('.')
            const { tokenKey } = JSON.parse(o.customInstructions as string)
            const tx = Transaction.fromBEEF(BEEF as number[], tokenTxid)
            const script = tx.outputs[Number(tokenOutputIndex)].lockingScript as LockingScript
            const { fields } = PushDrop.decode(script)

            const prefix = Utils.toBase64(fields[SLIP_DROP.prefix])
            const suffix = Utils.toBase64(fields[SLIP_DROP.suffix])
            const { publicKey } = await anyone.getPublicKey({
              protocolID: [2, '3241645161d8'],
              keyID: `${prefix} ${suffix}`,
              counterparty: me
            })

            parsed.push({
              prefix,
              suffix,
              used: fields[SLIP_DROP.used][0] !== 0,
              address: PublicKey.fromString(publicKey).toAddress(),
              memo: Utils.toUTF8(fields[SLIP_DROP.memo]),
              tokenKey,
              tokenTxid,
              tokenOutputIndex: Number(tokenOutputIndex),
              tokenBEEF: tx.toAtomicBEEF()
            })
          } catch (e: unknown) {
            console.error(e)
            // ignore malformed
          }
        }
        setDepositSlips(parsed)
      } catch (e: any) {
        setError(e?.message || 'Failed to list deposit slips.')
      }
    })()
  }, [])

  // Create deposit slip (keeps your logic)
  const createDepositSlip = async (memo: string = '') => {
    try {
      const prefix = Random(32)
      const suffix = Random(32)
      const tokenKey = Utils.toBase64(Random(32))

      const script = await new PushDrop(wallet).lock(
        [prefix, suffix, [0], Utils.toArray(memo, 'utf8')],
        SLIP_PROTOCOL,
        tokenKey,
        'self'
      )

      const { txid, tx } = await wallet.createAction({
        description: 'Create deposit slip',
        outputs: [{
          outputDescription: 'Deposit slip',
          satoshis: 1,
          lockingScript: script.toHex(),
          basket: 'deposit slips',
          customInstructions: JSON.stringify({ tokenKey })
        }],
        options: { acceptDelayedBroadcast: false, randomizeOutputs: false }
      })

      const prefixStr = Utils.toBase64(prefix)
      const suffixStr = Utils.toBase64(suffix)
      const { publicKey: me } = await wallet.getPublicKey({ identityKey: true })
      const { publicKey } = await anyone.getPublicKey({
        protocolID: [2, '3241645161d8'],
        keyID: `${prefixStr} ${suffixStr}`,
        counterparty: me
      })

      setDepositSlips((old) => [
        ...old,
        {
          prefix: prefixStr,
          suffix: suffixStr,
          used: false,
          memo,
          tokenKey,
          address: PublicKey.fromString(publicKey).toAddress(),
          tokenTxid: txid as string,
          tokenOutputIndex: 0,
          tokenBEEF: tx as number[]
        }
      ])
      setNewSlipMemo('')
    } catch (e: any) {
      setError(e?.message || 'Failed to create deposit slip.')
    }
  }

  // Deposit pasted Atomic BEEF into the selected slip (keeps your logic)
  const makeDeposit = async (atomicBEEF: string, slipIndex: number) => {
    setIsDepositing(true)
    setError(null)
    try {
      const atomicArray = Utils.toArray(atomicBEEF, 'hex') as number[]
      const slip = depositSlips[slipIndex] as Slip
      const tx = Transaction.fromAtomicBEEF(atomicArray)

      const { publicKey: me } = await wallet.getPublicKey({ identityKey: true })
      const { publicKey } = await anyone.getPublicKey({
        protocolID: [2, '3241645161d8'],
        keyID: `${slip.prefix} ${slip.suffix}`,
        counterparty: me
      })

      const correctPKHHex = PublicKey.fromString(publicKey).toHash('hex')

      const foundOutputIndex = tx.outputs.findIndex(o => {
        if (o.lockingScript.chunks.length < 5) return false
        const pkh = o.lockingScript.chunks[2].data as number[]
        if (!Array.isArray(pkh)) return false
        if (pkh.length !== 20) return false
        return Utils.toHex(pkh) === correctPKHHex
      })

      if (foundOutputIndex === -1) {
        setError('No output from this transaction pays this deposit slip.')
        setIsDepositing(false)
        return
      }

      await wallet.internalizeAction({
        tx: atomicArray,
        description: 'Deposit funds from deposit slip',
        outputs: [{
          outputIndex: foundOutputIndex,
          protocol: 'wallet payment',
          paymentRemittance: {
            derivationPrefix: slip.prefix,
            derivationSuffix: slip.suffix,
            senderIdentityKey: anyone.keyDeriver?.identityKey as string
          }
        }]
      })

      // Mark slip as used (on-chain update)
      const newSlipScript = await new PushDrop(wallet).lock(
        [
          Utils.toArray(slip.prefix, 'base64'),
          Utils.toArray(slip.suffix, 'base64'),
          [1],
          Utils.toArray(slip.memo, 'utf8')
        ],
        SLIP_PROTOCOL,
        slip.tokenKey,
        'self'
      )

      const { signableTransaction } = await wallet.createAction({
        description: 'mark deposit slip as used',
        inputBEEF: slip.tokenBEEF,
        inputs: [{
          outpoint: `${slip.tokenTxid}.${slip.tokenOutputIndex}`,
          unlockingScriptLength: 74,
          inputDescription: 'Consume old deposit slip'
        }],
        outputs: [{
          outputDescription: 'Deposit slip',
          satoshis: 1,
          lockingScript: newSlipScript.toHex(),
          basket: 'deposit slips',
          customInstructions: JSON.stringify({ tokenKey: slip.tokenKey })
        }],
        options: { acceptDelayedBroadcast: false, randomizeOutputs: false }
      })

      const unlocker = new PushDrop(wallet).unlock(SLIP_PROTOCOL, slip.tokenKey, 'self')
      await wallet.signAction({
        reference: signableTransaction?.reference as string,
        spends: {
          0: {
            unlockingScript: (
              await unlocker.sign(
                Transaction.fromAtomicBEEF(signableTransaction?.tx as number[]),
                0
              )
            ).toHex()
          }
        }
      })

      // Optimistic UI: flag as used
      setDepositSlips(prev => {
        const clone = [...prev]
        if (clone[slipIndex]) clone[slipIndex].used = true
        return clone
      })

      setIncomingBEEF('')
      setExpandedSlipIndex(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to deposit Atomic BEEF.')
    } finally {
      setIsDepositing(false)
    }
  }

  // Outgoing funding (unchanged logic)
  const handleSend = async () => {
    setIsSending(true)
    setError(null)
    try {
      const { tx } = await wallet.createAction({
        description: 'Fund',
        outputs: [{
          outputDescription: 'Fund',
          lockingScript: new P2PKH().lock(sendToAddress).toHex(),
          satoshis: Number(sendAmount)
        }]
      })
      setSentAtomicBEEF(Utils.toHex(tx as number[]))
    } catch (e: any) {
      setError(e?.message || 'Failed to create action.')
    } finally {
      setIsSending(false)
    }
  }

  // Utils
  const copy = async (what: 'atom' | 'addr' | `slip-${number}`) => {
    let text = ''
    if (what === 'atom') text = sentAtomicBEEF
    else if (what === 'addr') text = sendToAddress
    else {
      const idx = Number(what.split('-')[1])
      text = depositSlips[idx]?.address || ''
    }

    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1200)
    } catch { /* noop */ }
  }

  const downloadSlipTxt = (slip: Slip) => {
    // Metanet Client–style deposit slip text and instructions (NOT the vault format)
    const now = new Date().toISOString()
    const txt = [
      'BSV Deposit Slip (Metanet Client)',
      '------------------------',
      `Memo:          ${slip.memo || '(none)'}`,
      `Used:          ${slip.used ? 'Yes' : 'No'}`,
      '',
      `Public key:    (derived via counterparty=anyone from prefix/suffix)`,
      `Pubkey hash:   (embedded in Address)`,
      `P2PKH Script:  (standard pay-to-pubkey-hash for Address)`,
      `Address:       ${slip.address}`,
      '',
      `Derivation Prefix (base64): ${slip.prefix}`,
      `Derivation Suffix (base64): ${slip.suffix}`,
      '',
      `Created/Exported At: ${now}`,
      '',
      'Instructions:',
      '- Use the Funder app to create an Atomic BEEF that PAYS THIS ADDRESS.',
      '- Paste that Atomic BEEF below in the Metanet Client to deposit to this slip.',
      '- Once deposited, this slip will be marked as USED. Do not reuse slips.',
      slip.used
        ? '- WARNING: This slip is already used. Reusing harms privacy and is discouraged.'
        : '',
      ''
    ].join('\n')

    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deposit-slip_${slip.address}${slip.used ? '_USED' : ''}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const sortedSlips = useMemo(() => {
    const fresh = depositSlips.filter(s => !s.used)
    const used = depositSlips.filter(s => s.used)
    return [...fresh, ...used]
  }, [depositSlips])

  const canSend = !!sendToAddress && !!sendAmount && !isSending

  return (
    <div className="app-root">
      <div className="card">
        <h1 className="title">Funder</h1>

        {/* Tabs */}
        <div className="tabs" role="tablist" aria-label="Wallet actions">
          <button
            role="tab"
            aria-selected={tab === 'outgoing'}
            className={`tab ${tab === 'outgoing' ? 'active' : ''}`}
            onClick={() => setTab('outgoing')}
          >
            Outgoing
          </button>
          <button
            role="tab"
            aria-selected={tab === 'incoming'}
            className={`tab ${tab === 'incoming' ? 'active' : ''}`}
            onClick={() => setTab('incoming')}
          >
            Incoming
          </button>
        </div>

        {/* OUTGOING TAB */}
        {tab === 'outgoing' && (
          <>
            <label className="label">
              Address
              <div className="row">
                <input
                  className="input wide"
                  placeholder="Enter an address..."
                  type="text"
                  value={sendToAddress}
                  onChange={(e) => setSendToAddress(e.target.value)}
                />
                <button
                  className="ghost"
                  onClick={() => copy('addr')}
                  title="Copy address"
                  disabled={!sendToAddress}
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
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
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
                  disabled={!sentAtomicBEEF}
                  title="Copy Atomic BEEF"
                >
                  {copied === 'atom' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <pre className="atom-box">
                {sentAtomicBEEF || '— nothing yet —'}
              </pre>
            </div>
          </>
        )}

        {/* INCOMING TAB */}
        {tab === 'incoming' && (
          <>
            <div className="section-head">
              <div className="left">
                <div className="subtitle">Deposit Slips</div>
                <div className="muted">Unused slips appear first. Reuse is discouraged.</div>
              </div>
              <div className="right new-slip">
                <input
                  className="input memo"
                  placeholder="Memo (optional)"
                  value={newSlipMemo}
                  onChange={(e) => setNewSlipMemo(e.target.value)}
                />
                <button className="primary" onClick={() => createDepositSlip(newSlipMemo)}>
                  New Slip
                </button>
              </div>
            </div>

            <div className="slip-list">
              {sortedSlips.length === 0 && (
                <div className="empty">No deposit slips yet. Create one above.</div>
              )}

              {sortedSlips.map((slip) => {
                // Map back to actual index in depositSlips for actions/state
                const realIndex = depositSlips.findIndex(s =>
                  s.prefix === slip.prefix &&
                  s.suffix === slip.suffix &&
                  s.tokenTxid === slip.tokenTxid &&
                  s.tokenOutputIndex === slip.tokenOutputIndex
                )

                const isExpanded = expandedSlipIndex === realIndex
                const warnReuse = slip.used

                return (
                  <div className={`slip ${warnReuse ? 'used' : ''}`} key={`${slip.tokenTxid}.${slip.tokenOutputIndex}`}>
                    <div className="slip-row">
                      <div className="slip-meta">
                        <div className="slip-topline">
                          <span className="badge">{warnReuse ? 'USED' : 'NEW'}</span>
                          <span className="addr">{slip.address}</span>
                        </div>
                        <div className="meta-line">
                          <span className="tag">prefix</span>
                          <span className="mono small">{slip.prefix}</span>
                          <span className="sep">·</span>
                          <span className="tag">suffix</span>
                          <span className="mono small">{slip.suffix}</span>
                          {slip.memo ? (
                            <>
                              <span className="sep">·</span>
                              <span className="tag">memo</span>
                              <span className="mono small">{slip.memo}</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="slip-actions">
                        <button
                          className="ghost"
                          onClick={() => copy(`slip-${realIndex}`)}
                          disabled={!slip.address}
                          title="Copy address"
                        >
                          {copied === `slip-${realIndex}` ? '✓ Copied' : 'Copy'}
                        </button>
                        <button
                          className="ghost"
                          onClick={() => {
                            if (slip.used) {
                              const ok = window.confirm(
                                'This slip is already used. Reusing harms privacy. Continue to download anyway?'
                              )
                              if (!ok) return
                            }
                            downloadSlipTxt(slip)
                          }}
                          title="Download deposit slip (.txt)"
                        >
                          Download
                        </button>
                        <button
                          className="primary"
                          onClick={() => {
                            // If switching between rows, clear paste area
                            setIncomingBEEF('')
                            setExpandedSlipIndex(isExpanded ? null : realIndex)
                          }}
                        >
                          {isExpanded ? 'Close' : 'Deposit Atomic BEEF'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="slip-expand">
                        {warnReuse && (
                          <div className="warning">
                            <strong>Warning:</strong> this slip is marked <strong>USED</strong>. Reusing harms privacy and is discouraged.
                          </div>
                        )}

                        <div className="label">Paste Atomic BEEF</div>
                        <textarea
                          className="textarea"
                          placeholder="Hex-encoded Atomic BEEF that pays the slip’s address…"
                          value={incomingBEEF}
                          onChange={(e) => setIncomingBEEF(e.target.value.trim())}
                        />
                        <div className="actions-row">
                          <button
                            className={`primary ${!incomingBEEF || isDepositing ? 'disabled' : ''}`}
                            disabled={!incomingBEEF || isDepositing}
                            onClick={() => {
                              if (warnReuse) {
                                const ok = window.confirm(
                                  'This slip is already used. Are you sure you want to attempt another deposit to it?'
                                )
                                if (!ok) return
                              }
                              makeDeposit(incomingBEEF, realIndex)
                            }}
                          >
                            {isDepositing ? (
                              <span className="spinner-wrap"><span className="spinner" /> Depositing…</span>
                            ) : (
                              'Deposit to Wallet'
                            )}
                          </button>
                          <button
                            className="ghost"
                            onClick={() => setIncomingBEEF('')}
                            disabled={!incomingBEEF || isDepositing}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {error && <p className="error">{error}</p>}
          </>
        )}

        {/* Instructions Panel */}
<details className="guide" open>
  <summary className="guide-summary">
    <span className="guide-title">How this works</span>
    <span className="guide-toggle">Show/Hide</span>
  </summary>

  <div className="guide-body">
    <div className="callout success">
      <strong>Goal:</strong> Move funds between “Metanet Client” (MNC) and anyone—without chain scanning—using <em>Atomic BEEF</em>.
    </div>

    <div className="steps">
      <h4>Receiving funds (Incoming tab)</h4>
      <ol>
        <li><strong>Generate a Deposit Slip.</strong> It creates a fresh address derived from your prefix/suffix (counterparty=<code>anyone</code>).</li>
        <li><strong>Give the Address</strong> from that slip to the sender.</li>
        <li><strong>Sender must provide Atomic BEEF.</strong> Ask them to use this Funder app (or any tool that outputs Atomic BEEF) to pay your slip’s address.</li>
        <li><strong>Paste Atomic BEEF</strong> into the slip’s “Deposit Atomic BEEF” area and click <em>Deposit to Wallet</em>. The slip is then <strong>marked USED</strong>.</li>
        <li><strong>Privacy note:</strong> Don’t reuse deposit slips. Used slips are pushed to the bottom and clearly warned.</li>
      </ol>

      <h4>Sending funds (Outgoing tab)</h4>
      <ol>
        <li><strong>Enter the recipient’s address</strong> and amount.</li>
        <li><strong>Click Send</strong> and you’ll get an <em>Atomic BEEF</em> for that spend.</li>
        <li><strong>Give the Atomic BEEF</strong> to the recipient. They can internalize it without any third-party scanners.</li>
      </ol>
    </div>

    <div className="callout info">
      <strong>What if the sender’s wallet doesn’t give Atomic BEEF?</strong><br />
      Best practice is for wallets to include Atomic BEEF when sending to an address. If they can’t, the recipient can fall back to a chain-scanning service as a last resort, but it <strong>reduces privacy</strong> and adds third-party reliance. Encourage senders to use tools that export Atomic BEEF.
    </div>

    <div className="steps">
      <h4>Exporting a Deposit Slip</h4>
      <ul>
        <li>Use <em>Download</em> on a slip to save a <code>.txt</code> with address + instructions.</li>
        <li>Downloading a <strong>USED</strong> slip is allowed but warned—avoid reuse to preserve privacy.</li>
      </ul>
    </div>

    <div className="callout warn">
      <strong>Warnings</strong>
      <ul>
        <li>Reusing deposit slips harms privacy and may link activity.</li>
        <li>Only deposit Atomic BEEF that actually pays the slip’s address—otherwise it will be rejected.</li>
        <li>Keep your exported files safe. They may contain derivation hints and workflow guidance.</li>
      </ul>
    </div>
  </div>
</details>

      </div>
    </div>
  )
}

export default App
