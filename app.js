// ProofDrop - updated app.js with robust Web3Modal connect for Ethereum Mainnet
(async function(){
  const $ = s => document.querySelector(s);

  let config = {};
  try {
    const resp = await fetch('config.json');
    config = await resp.json();
  } catch(e){
    console.warn('Failed to load config.json', e);
  }

  // WalletConnect provider options
  const providerOptions = {
    walletconnect: {
      package: window.WalletConnectProvider.default,
      options: {
        rpc: {
          1: "https://rpc.ankr.com/eth" // fallback RPC for WalletConnect (public)
        }
      }
    }
  };

  const web3Modal = new window.Web3Modal.default({
    cacheProvider: false,
    providerOptions,
    theme: "dark",
    network: "mainnet" // hint to providers
  });

  const connectBtn = $('#connectBtn');
  const walletCard = $('#walletCard');
  const walletAddr = $('#walletAddr');
  const chainEl = $('#connectedChain');
  const badgeEl = $('#badge');
  const scoreVal = $('#scoreVal');
  const scoreBar = $('#scoreBar');
  const breakdownEl = $('#breakdown');
  const rawOut = $('#rawOutput');

  let providerInstance = null;
  let ethersProvider = null;
  let signer = null;
  let address = null;

  connectBtn.addEventListener('click', onConnectClicked);

  async function onConnectClicked(){
    try {
      providerInstance = await web3Modal.connect();
      // wrap with ethers provider
      ethersProvider = new ethers.providers.Web3Provider(providerInstance, 'any');
      // wait until provider is ready and network detected
      try {
        // provider.ready ensures network and chainId are available in many providers
        if (typeof providerInstance.request === 'function') {
          // some providers expose chainId via eth_chainId
          await providerInstance.request({ method: 'eth_chainId' }).catch(()=>{});
        }
      } catch(e){ console.warn('provider ready check failed', e); }

      // get network - this may throw if provider doesn't respond
      const network = await ethersProvider.getNetwork();

      // enforce Ethereum mainnet
      if(network.chainId !== 1){
        // try to request chain switch for injected wallets (e.g., MetaMask)
        try {
          await providerInstance.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x1' }]
          });
          // after switch, refresh provider and network
          ethersProvider = new ethers.providers.Web3Provider(providerInstance, 'any');
        } catch(switchErr){
          // user might reject or wallet may not support programmatic switch
          alert('Please switch your wallet network to Ethereum Mainnet and reconnect.');
          console.warn('Network switch failed or rejected', switchErr);
          return;
        }
      }

      // now safe to get signer & address
      signer = ethersProvider.getSigner();
      address = await signer.getAddress();

      const finalNetwork = await ethersProvider.getNetwork();
      walletAddr.textContent = address;
      chainEl.textContent = 'Network: ' + (finalNetwork.name || finalNetwork.chainId);
      walletCard.style.display = 'block';

      // listen for network/account changes and handle them
      if(providerInstance.on){
        providerInstance.on('chainChanged', handleChainChanged);
        providerInstance.on('accountsChanged', handleAccountsChanged);
        providerInstance.on('disconnect', handleDisconnect);
      }

      // compute score
      await scoreWallet(address);

    } catch(err){
      console.error('Connect failed', err);
      alert('Connect failed: ' + (err && err.message ? err.message : String(err)));
    }
  }

  async function handleChainChanged(chainIdHex){
    // chainIdHex like '0x1'
    const chainId = parseInt(chainIdHex, 16);
    if(chainId !== 1){
      alert('You switched networks. Please switch to Ethereum Mainnet (chainId 1).');
      // optionally hide UI
      walletCard.style.display = 'none';
    } else {
      // if switched back to mainnet, refresh score
      if(signer){
        const addr = await signer.getAddress();
        await scoreWallet(addr);
      }
    }
  }

  async function handleAccountsChanged(accounts){
    if(!accounts || accounts.length === 0){
      // user disconnected accounts in wallet
      walletCard.style.display = 'none';
      return;
    }
    // use first account
    const newAddr = accounts[0];
    walletAddr.textContent = newAddr;
    await scoreWallet(newAddr);
  }

  function handleDisconnect(code, reason){
    console.warn('Provider disconnected', code, reason);
    walletCard.style.display = 'none';
  }

  // main scoring flow (uses Covalent placeholders)
  async function scoreWallet(addr){
    scoreVal.textContent = '...';
    scoreBar.style.width = '0%';
    badgeEl.textContent = 'Calculating...';
    breakdownEl.innerHTML = '';
    rawOut.textContent = '';

    const chain = config.chain_id || 1;
    const covKey = config.covalent_api_key || 'YOUR_COVALENT_API_KEY';
    const balancesUrl = `https://api.covalenthq.com/v1/${chain}/address/${addr}/balances_v2/?quote-currency=USD&format=JSON&nft=false&key=${covKey}`;
    const txsUrl = `https://api.covalenthq.com/v1/${chain}/address/${addr}/transactions_v3/?page-size=100&key=${covKey}`;

    let balances = [], txs = [];
    try {
      const [bRes, tRes] = await Promise.all([fetch(balancesUrl), fetch(txsUrl)]);
      const bJson = await bRes.json();
      const tJson = await tRes.json();
      balances = bJson?.data?.items || [];
      txs = tJson?.data?.items || [];
    } catch(e){
      console.warn('Covalent fetch error', e);
    }

    const metrics = deriveMetrics(addr, balances, txs);

    // optional The Graph: governance & airdrops
    try {
      if(config.thegraph_endpoints && config.thegraph_endpoints.governance){
        const q = { query: 'query($wallet:String!){ votes(where:{voter:$wallet}){id} }', variables:{ wallet: addr.toLowerCase() } };
        const resp = await fetch(config.thegraph_endpoints.governance, { method:'POST', body: JSON.stringify(q), headers:{ 'Content-Type':'application/json' }});
        const j = await resp.json();
        metrics.governanceVotes = (j?.data?.votes || []).length || 0;
      }
      if(config.thegraph_endpoints && config.thegraph_endpoints.airdrops){
        const q2 = { query: 'query($wallet:String!){ airdropClaims(where:{claimer:$wallet}){id} }', variables:{ wallet: addr.toLowerCase() } };
        const resp2 = await fetch(config.thegraph_endpoints.airdrops, { method:'POST', body: JSON.stringify(q2), headers:{ 'Content-Type':'application/json' }});
        const j2 = await resp2.json();
        metrics.airdropsClaimed = (j2?.data?.airdropClaims || []).length || 0;
      }
    } catch(e){
      console.warn('TheGraph fetch failed (placeholder)', e);
    }

    // optional Moralis: DeFi interactions (if key provided)
    try {
      if(config.moralis_api_key && config.moralis_api_key !== 'YOUR_MORALIS_KEY'){
        const morUrl = `https://deep-index.moralis.io/api/v2/${addr}/transactions?chain=eth`;
        const resp = await fetch(morUrl, { headers: { 'X-API-Key': config.moralis_api_key }});
        const jm = await resp.json();
        metrics.defiActions = (jm || []).filter(tx=>tx.to && tx.input && tx.input.length>2).length;
      }
    } catch(e){
      console.warn('Moralis fetch failed (placeholder)', e);
    }

    const scoring = computeScore(metrics, config);
    render(metrics, scoring);
  }

  function deriveMetrics(addr, balances, txs){
    let totalUsd = 0;
    balances.forEach(b => totalUsd += Number(b.quote || 0));

    const routers = (config.dex_router_addresses || []).map(a=>a.toLowerCase());
    const contracts = new Set();
    let swapCount = 0;
    let airdropLike = 0;

    for(const t of txs){
      if(t.to_address) contracts.add(t.to_address.toLowerCase());
      if(t.log_events){
        for(const ev of t.log_events){
          if(ev.sender_address) contracts.add(ev.sender_address.toLowerCase());
          const name = String(ev.decoded?.name || '').toLowerCase();
          if(name.includes('swap')) swapCount++;
          if(name === 'transfer' && ev.decoded && ev.decoded.params){
            const params = ev.decoded.params;
            const to = params.find(p=>['to','dst','recipient'].includes(p.name));
            if(to && to.value && to.value.toLowerCase() === addr.toLowerCase()){
              airdropLike++;
            }
          }
          const saddr = (ev.sender_address || '').toLowerCase();
          if(routers.includes(saddr)) swapCount++;
        }
      }
    }

    return {
      totalUsd: Number(totalUsd.toFixed(2)),
      dexSwaps: Math.max(0, swapCount),
      uniqueContracts: contracts.size,
      governanceVotes: 0,
      defiActions: 0,
      airdropsClaimed: airdropLike
    };
  }

  function computeScore(metrics, cfg){
    let score = 0;
    const gov = metrics.governanceVotes || 0;
    if(gov >= 5) score += 20;
    else if(gov >= 3) score += 15;
    else if(gov >= 1) score += 5;

    const defi = metrics.defiActions || 0;
    if(defi >= 10) score += 20;
    else if(defi >= 5) score += 10;
    else if(defi >= 1) score += 5;

    const uc = metrics.uniqueContracts || 0;
    if(uc >= 20) score += 15;
    else if(uc >= 10) score += 10;
    else if(uc >= 5) score += 5;

    const aud = metrics.airdropsClaimed || 0;
    if(aud >= 5) score += 15;
    else if(aud >= 3) score += 10;
    else if(aud >= 1) score += 5;

    const s = metrics.dexSwaps || 0;
    if(s >= 25) score += 15;
    else if(s >= 15) score += 10;
    else if(s >= 5) score += 5;
    else if(s >= 2) score += 1;

    const bal = metrics.totalUsd || 0;
    if(bal > 250) score += 15;
    else if(bal > 50) score += 10;
    else if(bal >= 10) score += 5;

    score = Math.max(0, Math.min(100, Math.round(score)));
    return { score, breakdown: { governance: gov, defi: defi, uniqueContracts: uc, airdrops: aud, dexSwaps: s, totalUsd: bal } };
  }

  function render(metrics, scoring){
    scoreVal.textContent = scoring.score;
    scoreBar.style.width = scoring.score + '%';

    let badge = 'Newbie';
    if(scoring.score >= 90) badge = 'Diamond';
    else if(scoring.score >= 75) badge = 'Gold';
    else if(scoring.score >= 50) badge = 'Silver';
    else if(scoring.score >= 25) badge = 'Bronze';
    badgeEl.textContent = badge;

    breakdownEl.innerHTML = `
      <strong>Breakdown</strong>
      <ul>
        <li>Governance votes: ${scoring.breakdown.governance}</li>
        <li>DeFi actions (approx): ${scoring.breakdown.defi}</li>
        <li>Unique contracts interacted: ${scoring.breakdown.uniqueContracts}</li>
        <li>Airdrops claimed (approx): ${scoring.breakdown.airdrops}</li>
        <li>DEX swaps detected: ${scoring.breakdown.dexSwaps}</li>
        <li>On-chain balance (USD): $${scoring.breakdown.totalUsd}</li>
      </ul>
    `;
    rawOut.textContent = JSON.stringify({metrics, scoring}, null, 2);
  }

})();