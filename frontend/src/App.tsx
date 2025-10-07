import { useState } from 'react'
import './App.css'
import { WalletClient, P2PKH, Utils } from '@bsv/sdk'

const wallet = new WalletClient()

function App() {
  const [addr, setAddr] = useState('')
  const [amt, setAmt] = useState('')
  const [atom, setAtom] = useState('')

  const handleSend = async () => {
    const { tx } = await wallet.createAction({
      description: 'Fund',
      outputs: [{
        outputDescription: 'Fund',
        lockingScript: new P2PKH().lock(addr).toHex(),
        satoshis: Number(amt)
      }]
    })
    setAtom(Utils.toHex(tx as number[]))
  }

  return (
    <>
    <h1>Funder</h1>
    <input placeholder='Enter an address...' type='text' value={addr} onChange={(e) => setAddr(e.target.value)} />
    <br />
    <input placeholder='Amount (satoshis)' type='number' value={amt} onChange={(e) => setAmt(e.target.value)} />
    <br />
    <button onClick={handleSend}>Send</button>
    <p>{atom}</p>
    </>
  )
}

export default App
