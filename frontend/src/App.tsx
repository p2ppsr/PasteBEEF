import { useEffect, useState } from 'react'
import './App.css'
import { WalletClient, P2PKH, Utils, PushDrop, LockingScript, ProtoWallet, PublicKey, Random, Transaction, type WalletProtocol } from '@bsv/sdk'

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

const SLIP_DROP = {
  prefix: 0,
  suffix: 1,
  used: 2,
  memo: 3
}

const SLIP_PROTOCOL: WalletProtocol = [2, 'deposit slip']

const wallet = new WalletClient()
const anyone = new ProtoWallet('anyone')

function App() {
  const [sendToAddress, setSendToAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sentAtomicBEEF, setSentAtomicBEEF] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [copied, setCopied] = useState<null | 'atom' | 'addr'>(null)
  const [depositSlips, setDepositSlips] = useState<Array<Slip>>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { outputs, BEEF } = await wallet.listOutputs({
        basket: 'deposit slips',
        include: 'entire transactions'
      })
      const parsedSlips: Array<Slip> = []
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
            counterparty: me,
          })
          parsedSlips.push({
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
        } catch (e: any) {
          // ignore
        }
      }
      setDepositSlips(parsedSlips)
    })()
  }, [])

  const createDepositSlip = async (memo: string = '') => {
    const prefix = Random(32)
    const suffix = Random(32)
    const tokenKey = Utils.toBase64(Random(32))
    const script = await new PushDrop(wallet).lock([
      prefix,
      suffix,
      [0],
      Utils.toArray(memo, 'utf8')
    ], SLIP_PROTOCOL, tokenKey, 'self')
    const { txid, tx } = await wallet.createAction({
      description: 'Create deposit slip',
      outputs: [{
        outputDescription: 'Deposit slip',
        satoshis: 1,
        lockingScript: script.toHex(),
        basket: 'deposit slips',
        customInstructions: JSON.stringify({ tokenKey })
      }],
      options: {
        acceptDelayedBroadcast: false,
        randomizeOutputs: false
      }
    })
    const prefixStr = Utils.toBase64(prefix)
    const suffixStr = Utils.toBase64(suffix)
    const { publicKey: me } = await wallet.getPublicKey({ identityKey: true })
    const { publicKey } = await anyone.getPublicKey({
      protocolID: [2, '3241645161d8'],
      keyID: `${prefixStr} ${suffixStr}`,
      counterparty: me,
    })
    setDepositSlips((oldSlips) => {
      oldSlips.push({
        prefix: prefixStr,
        suffix: suffixStr,
        used: false,
        memo,
        tokenKey,
        address: PublicKey.fromString(publicKey).toAddress(),
        tokenTxid: txid as string,
        tokenOutputIndex: 0,
        tokenBEEF: tx as number[]
      })
      return oldSlips
    })
  }

  const makeDeposit = async (atomicBEEF: string, slipIndex: number) => {
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
      if (o.lockingScript.chunks.length < 5) {
        return false
      }
      const pkh = o.lockingScript.chunks[2].data as number[]
      if (!Array.isArray(pkh)) {
        return false
      }
      if (pkh.length !== 20) {
        return false
      }
      return Utils.toHex(pkh) === correctPKHHex
    })
    if (foundOutputIndex === -1) {
      setError('No output from this transaction pays this deposit slip.')
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
    // Now we mark the slip as used
    const newSlipScript = await new PushDrop(wallet).lock([
      Utils.toArray(slip.prefix, 'base64'),
      Utils.toArray(slip.suffix, 'base64'),
      [1], // now it's used.
      Utils.toArray(slip.memo, 'utf8')
    ], SLIP_PROTOCOL, slip.tokenKey, 'self')
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
      options: {
        acceptDelayedBroadcast: false,
        randomizeOutputs: false
      }
    })
    const unlocker = new PushDrop(wallet).unlock(SLIP_PROTOCOL, slip.tokenKey, 'self')
    await wallet.signAction({
      reference: signableTransaction?.reference as string,
      spends: {
        0: {
          unlockingScript: (await unlocker.sign(Transaction.fromAtomicBEEF(signableTransaction?.tx as number[]), 0)).toHex()
        }
      }
    })
  }

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

  const copy = async (what: 'atom' | 'addr') => {
    const text = what === 'atom' ? sentAtomicBEEF : sendToAddress
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1200)
    } catch { /* noop */ }
  }

  const canSend = !!sendToAddress && !!sendAmount && !isSending

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

          {/* Rectangle container with wrapping + scroll if needed */}
          <pre className="atom-box">
            {sentAtomicBEEF || '— nothing yet —'}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default App
