import { ExternalProvider, Web3Provider } from '@ethersproject/providers'
import { WalletLink, WalletLinkProvider } from 'walletlink'
import { WalletLinkOptions } from 'walletlink/dist/WalletLink'

import { UserRejectedRequestError } from '../errors'
import { Chain } from '../types'
import { getAddress, normalizeChainId } from '../utils'
import { Connector } from './base'

type Options = WalletLinkOptions & { jsonRpcUrl?: string }

export class WalletLinkConnector extends Connector<
  WalletLinkProvider,
  Options
> {
  readonly id = 'walletLink'
  readonly name = 'Coinbase Wallet'
  readonly ready =
    typeof window !== 'undefined' && !window.ethereum?.isCoinbaseWallet

  private _client?: WalletLink
  private _provider?: WalletLinkProvider

  constructor(config: { chains?: Chain[]; options: Options }) {
    super(config)
  }

  async connect() {
    try {
      const provider = this.getProvider()
      provider.on('accountsChanged', this.onAccountsChanged)
      provider.on('chainChanged', this.onChainChanged)
      provider.on('disconnect', this.onDisconnect)

      const accounts = await provider.enable()
      const account = getAddress(accounts[0])
      const id = await this.getChainId()
      const unsupported = this.isChainUnsupported(id)
      return {
        account,
        chain: { id, unsupported },
        provider: new Web3Provider(<ExternalProvider>(<unknown>provider)),
      }
    } catch (error) {
      if ((<ProviderRpcError>error).message === 'User closed modal')
        throw new UserRejectedRequestError()
      throw error
    }
  }

  async disconnect() {
    if (!this._provider) return

    const provider = this.getProvider()
    provider.removeListener('accountsChanged', this.onAccountsChanged)
    provider.removeListener('chainChanged', this.onChainChanged)
    provider.removeListener('disconnect', this.onDisconnect)
    provider.disconnect()
    provider.close()

    if (typeof localStorage !== 'undefined') {
      let n = localStorage.length
      while (n--) {
        const key = localStorage.key(n)
        if (!key) continue
        if (!/-walletlink/.test(key)) continue
        localStorage.removeItem(key)
      }
    }
  }

  async getAccount() {
    const provider = this.getProvider()
    const accounts = await provider.request<string[]>({
      method: 'eth_accounts',
    })
    // return checksum address
    return getAddress(accounts[0])
  }

  async getChainId() {
    const provider = this.getProvider()
    const chainId = normalizeChainId(provider.chainId)
    return chainId
  }

  getProvider() {
    if (!this._provider) {
      this._client = new WalletLink(this.options)
      this._provider = this._client.makeWeb3Provider(this.options.jsonRpcUrl)
    }
    return this._provider
  }

  async getSigner() {
    const provider = this.getProvider()
    const account = await this.getAccount()
    return new Web3Provider(<ExternalProvider>(<unknown>provider)).getSigner(
      account,
    )
  }

  async isAuthorized() {
    try {
      const account = await this.getAccount()
      return !!account
    } catch {
      return false
    }
  }

  protected onAccountsChanged = (accounts: string[]) => {
    if (accounts.length === 0) this.emit('disconnect')
    else this.emit('change', { account: accounts[0] })
  }

  protected onChainChanged = (chainId: number | string) => {
    const id = normalizeChainId(chainId)
    const unsupported = this.isChainUnsupported(id)
    this.emit('change', { chain: { id, unsupported } })
  }

  protected onDisconnect = () => {
    this.emit('disconnect')
  }
}
