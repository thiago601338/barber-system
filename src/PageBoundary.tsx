import { Component, type ReactNode } from 'react'
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div className="state-card" role="alert"><h2>Não foi possível abrir esta área</h2><p>A versão do sistema pode ter sido atualizada ou sua conexão foi interrompida. Atualize a página para carregar novamente.</p><button className="button primary" onClick={() => window.location.reload()}>Atualizar página</button></div>
    return this.props.children
  }
}
