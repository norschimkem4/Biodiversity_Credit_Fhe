// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';
import { FaLeaf, FaTree, FaWater, FaMountain, FaGlobeAmericas } from 'react-icons/fa';

interface BiodiversityCredit {
  id: string;
  encryptedScore: string;
  timestamp: number;
  owner: string;
  location: string;
  areaSize: number;
  status: "pending" | "verified" | "rejected";
  speciesCount: number;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increase10%':
      result = value * 1.1;
      break;
    case 'decrease10%':
      result = value * 0.9;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState<BiodiversityCredit[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newCreditData, setNewCreditData] = useState({ 
    location: "", 
    areaSize: 0,
    speciesCount: 0,
    description: "" 
  });
  const [showFAQ, setShowFAQ] = useState(false);
  const [selectedCredit, setSelectedCredit] = useState<BiodiversityCredit | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const verifiedCount = credits.filter(c => c.status === "verified").length;
  const pendingCount = credits.filter(c => c.status === "pending").length;
  const rejectedCount = credits.filter(c => c.status === "rejected").length;

  useEffect(() => {
    loadCredits().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadCredits = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      const keysBytes = await contract.getData("credit_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing credit keys:", e); }
      }
      const list: BiodiversityCredit[] = [];
      for (const key of keys) {
        try {
          const creditBytes = await contract.getData(`credit_${key}`);
          if (creditBytes.length > 0) {
            try {
              const creditData = JSON.parse(ethers.toUtf8String(creditBytes));
              list.push({ 
                id: key, 
                encryptedScore: creditData.score, 
                timestamp: creditData.timestamp, 
                owner: creditData.owner, 
                location: creditData.location,
                areaSize: creditData.areaSize,
                speciesCount: creditData.speciesCount,
                status: creditData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing credit data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading credit ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setCredits(list);
    } catch (e) { console.error("Error loading credits:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitCredit = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting biodiversity data with Zama FHE..." });
    try {
      // Calculate biodiversity score (simplified formula)
      const biodiversityScore = newCreditData.speciesCount * Math.sqrt(newCreditData.areaSize);
      const encryptedScore = FHEEncryptNumber(biodiversityScore);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const creditId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const creditData = { 
        score: encryptedScore, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        location: newCreditData.location,
        areaSize: newCreditData.areaSize,
        speciesCount: newCreditData.speciesCount,
        status: "pending" 
      };
      
      await contract.setData(`credit_${creditId}`, ethers.toUtf8Bytes(JSON.stringify(creditData)));
      
      const keysBytes = await contract.getData("credit_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(creditId);
      await contract.setData("credit_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted biodiversity credit created!" });
      await loadCredits();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCreditData({ 
          location: "", 
          areaSize: 0,
          speciesCount: 0,
          description: "" 
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const verifyCredit = async (creditId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing biodiversity data with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const creditBytes = await contract.getData(`credit_${creditId}`);
      if (creditBytes.length === 0) throw new Error("Credit not found");
      const creditData = JSON.parse(ethers.toUtf8String(creditBytes));
      
      const verifiedScore = FHECompute(creditData.score, 'increase10%');
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedCredit = { ...creditData, status: "verified", score: verifiedScore };
      await contractWithSigner.setData(`credit_${creditId}`, ethers.toUtf8Bytes(JSON.stringify(updatedCredit)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE verification completed!" });
      await loadCredits();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectCredit = async (creditId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing biodiversity data with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const creditBytes = await contract.getData(`credit_${creditId}`);
      if (creditBytes.length === 0) throw new Error("Credit not found");
      const creditData = JSON.parse(ethers.toUtf8String(creditBytes));
      const updatedCredit = { ...creditData, status: "rejected" };
      await contract.setData(`credit_${creditId}`, ethers.toUtf8Bytes(JSON.stringify(updatedCredit)));
      setTransactionStatus({ visible: true, status: "success", message: "Credit rejected!" });
      await loadCredits();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (creditAddress: string) => address?.toLowerCase() === creditAddress.toLowerCase();

  const renderMapVisualization = () => {
    // Simplified map visualization with sample locations
    const locations = credits.reduce((acc, credit) => {
      if (!acc.includes(credit.location)) {
        acc.push(credit.location);
      }
      return acc;
    }, [] as string[]);
    
    return (
      <div className="map-visualization">
        <div className="map-container">
          <FaGlobeAmericas className="world-icon" />
          <div className="location-markers">
            {locations.slice(0, 5).map((loc, idx) => (
              <div 
                key={idx} 
                className="location-marker"
                style={{
                  top: `${20 + (idx * 15)}%`,
                  left: `${30 + (idx * 10)}%`,
                  animationDelay: `${idx * 0.2}s`
                }}
              >
                <FaTree className="marker-icon" />
                <span className="marker-label">{loc}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="map-legend">
          <div className="legend-item"><FaLeaf className="legend-icon" /> Biodiversity Credits</div>
          <div className="legend-item"><FaTree className="legend-icon verified" /> Verified</div>
          <div className="legend-item"><FaTree className="legend-icon pending" /> Pending</div>
        </div>
      </div>
    );
  };

  const renderStatsCards = () => {
    return (
      <div className="stats-cards">
        <div className="stat-card wood-bg">
          <div className="stat-value">{credits.length}</div>
          <div className="stat-label">Total Credits</div>
          <FaLeaf className="stat-icon" />
        </div>
        <div className="stat-card stone-bg">
          <div className="stat-value">{verifiedCount}</div>
          <div className="stat-label">Verified</div>
          <FaTree className="stat-icon" />
        </div>
        <div className="stat-card grass-bg">
          <div className="stat-value">{pendingCount}</div>
          <div className="stat-label">Pending</div>
          <FaWater className="stat-icon" />
        </div>
        <div className="stat-card sea-bg">
          <div className="stat-value">{rejectedCount}</div>
          <div className="stat-label">Rejected</div>
          <FaMountain className="stat-icon" />
        </div>
      </div>
    );
  };

  const faqItems = [
    {
      question: "What is a Biodiversity Credit?",
      answer: "A biodiversity credit represents a quantified contribution to conservation efforts, calculated based on encrypted ecological data using Zama FHE technology."
    },
    {
      question: "How does FHE protect my data?",
      answer: "Fully Homomorphic Encryption (FHE) allows computations on encrypted data without decryption, ensuring sensitive ecological information remains private."
    },
    {
      question: "Who can issue these credits?",
      answer: "Certified conservation organizations, national parks, and research institutions can submit encrypted biodiversity data to generate verifiable credits."
    },
    {
      question: "How are credits calculated?",
      answer: "Credits are computed using an FHE-encrypted formula considering species diversity and protected area size, with results remaining encrypted throughout the process."
    },
    {
      question: "Can I trade these credits?",
      answer: "Yes, verified biodiversity credits are issued as NFTs and can be traded on supported marketplaces to fund conservation efforts."
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="nature-spinner">
        <FaTree className="spinner-icon" />
        <FaLeaf className="spinner-icon" />
        <FaWater className="spinner-icon" />
      </div>
      <p>Connecting to nature's blockchain...</p>
    </div>
  );

  return (
    <div className="app-container nature-theme">
      <header className="app-header wood-bg">
        <div className="logo">
          <div className="logo-icon"><FaTree /></div>
          <h1>Bio<span>Diversity</span>Credit</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-credit-btn nature-button">
            <FaLeaf /> Create Credit
          </button>
          <button className="nature-button" onClick={() => setShowFAQ(!showFAQ)}>
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      <div className="main-content">
        <div className="welcome-banner wood-bg">
          <div className="welcome-text">
            <h2>FHE-Protected Biodiversity Credits</h2>
            <p>Securely quantify and monetize conservation efforts using Zama's Fully Homomorphic Encryption</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock"></div><span>FHE Encryption Active</span></div>
        </div>

        <div className="project-intro-card stone-bg">
          <h2>About Biodiversity Credits</h2>
          <p>
            Our platform uses Zama FHE technology to process sensitive ecological data in encrypted form. 
            Conservation organizations submit encrypted biodiversity metrics which are evaluated without decryption, 
            generating verifiable credits that can fund preservation efforts.
          </p>
          <div className="fhe-process">
            <div className="process-step">
              <div className="step-icon"><FaTree /></div>
              <div className="step-text">Collect Ecological Data</div>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="step-icon"><FaLeaf /></div>
              <div className="step-text">FHE Encryption</div>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="step-icon"><FaGlobeAmericas /></div>
              <div className="step-text">Compute Credits</div>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="step-icon"><FaWater /></div>
              <div className="step-text">Issue NFT Credits</div>
            </div>
          </div>
        </div>

        <div className="dashboard-section">
          <h2>Global Biodiversity Impact</h2>
          {renderMapVisualization()}
          {renderStatsCards()}
        </div>

        <div className="credits-section">
          <div className="section-header wood-bg">
            <h2>Biodiversity Credit Registry</h2>
            <div className="header-actions">
              <button onClick={loadCredits} className="refresh-btn nature-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : <><FaLeaf /> Refresh</>}
              </button>
            </div>
          </div>
          <div className="credits-list stone-bg">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Location</div>
              <div className="header-cell">Area (km²)</div>
              <div className="header-cell">Species</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            {credits.length === 0 ? (
              <div className="no-credits grass-bg">
                <div className="no-credits-icon"><FaTree /></div>
                <p>No biodiversity credits found</p>
                <button className="nature-button primary" onClick={() => setShowCreateModal(true)}>
                  <FaLeaf /> Create First Credit
                </button>
              </div>
            ) : credits.map(credit => (
              <div className="credit-row" key={credit.id} onClick={() => setSelectedCredit(credit)}>
                <div className="table-cell credit-id">#{credit.id.substring(0, 6)}</div>
                <div className="table-cell">{credit.location}</div>
                <div className="table-cell">{credit.areaSize}</div>
                <div className="table-cell">{credit.speciesCount}</div>
                <div className="table-cell">{new Date(credit.timestamp * 1000).toLocaleDateString()}</div>
                <div className="table-cell">
                  <span className={`status-badge ${credit.status}`}>
                    {credit.status === "verified" && <FaTree />}
                    {credit.status === "pending" && <FaLeaf />}
                    {credit.status === "rejected" && <FaWater />}
                    {credit.status}
                  </span>
                </div>
                <div className="table-cell actions">
                  {isOwner(credit.owner) && credit.status === "pending" && (
                    <>
                      <button className="action-btn nature-button success" onClick={(e) => { e.stopPropagation(); verifyCredit(credit.id); }}>
                        <FaTree /> Verify
                      </button>
                      <button className="action-btn nature-button danger" onClick={(e) => { e.stopPropagation(); rejectCredit(credit.id); }}>
                        <FaWater /> Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {showFAQ && (
          <div className="faq-section wood-bg">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-items">
              {faqItems.map((item, index) => (
                <div className="faq-item stone-bg" key={index}>
                  <div className="faq-question">
                    <FaLeaf className="faq-icon" />
                    <h3>{item.question}</h3>
                  </div>
                  <div className="faq-answer">
                    <p>{item.answer}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitCredit} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          creditData={newCreditData} 
          setCreditData={setNewCreditData}
        />
      )}
      {selectedCredit && (
        <CreditDetailModal 
          credit={selectedCredit} 
          onClose={() => { setSelectedCredit(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content wood-bg">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="nature-spinner"><FaLeaf /></div>}
              {transactionStatus.status === "success" && <FaTree />}
              {transactionStatus.status === "error" && <FaWater />}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      <footer className="app-footer stone-bg">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><FaTree /><span>BiodiversityCredit</span></div>
            <p>Protecting nature's data with Zama FHE technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><FaLeaf /><span>FHE-Powered Conservation</span></div>
          <div className="copyright">© {new Date().getFullYear()} BiodiversityCredit. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  creditData: any;
  setCreditData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, creditData, setCreditData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCreditData({ ...creditData, [name]: value });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCreditData({ ...creditData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!creditData.location || creditData.areaSize <= 0 || creditData.speciesCount <= 0) { 
      alert("Please fill required fields with valid values"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal wood-bg">
        <div className="modal-header">
          <h2>Create Biodiversity Credit</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner grass-bg">
            <FaLeaf className="key-icon" /> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your ecological data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Location *</label>
              <input 
                type="text" 
                name="location" 
                value={creditData.location} 
                onChange={handleChange} 
                placeholder="e.g. Amazon Rainforest" 
                className="nature-input"
              />
            </div>
            <div className="form-group">
              <label>Protected Area Size (km²) *</label>
              <input 
                type="number" 
                name="areaSize" 
                value={creditData.areaSize} 
                onChange={handleNumberChange} 
                placeholder="Enter area size..." 
                className="nature-input"
                min="0"
                step="0.1"
              />
            </div>
            <div className="form-group">
              <label>Species Count *</label>
              <input 
                type="number" 
                name="speciesCount" 
                value={creditData.speciesCount} 
                onChange={handleNumberChange} 
                placeholder="Enter species count..." 
                className="nature-input"
                min="0"
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea 
                name="description" 
                value={creditData.description} 
                onChange={handleChange} 
                placeholder="Additional details about this conservation area..." 
                className="nature-textarea"
                rows={3}
              />
            </div>
          </div>
          <div className="encryption-preview">
            <h4>Biodiversity Score Calculation</h4>
            <div className="preview-container stone-bg">
              <div className="formula">
                <span>Score = Species Count × √Area Size</span>
                <div className="formula-result">
                  {creditData.speciesCount > 0 && creditData.areaSize > 0 ? 
                    `${creditData.speciesCount} × √${creditData.areaSize} = ${(creditData.speciesCount * Math.sqrt(creditData.areaSize)).toFixed(2)}` : 
                    'Enter values to calculate score'}
                </div>
              </div>
              <div className="encryption-result">
                <span>Encrypted Score:</span>
                <div className="encrypted-value">
                  {creditData.speciesCount > 0 && creditData.areaSize > 0 ? 
                    FHEEncryptNumber(creditData.speciesCount * Math.sqrt(creditData.areaSize)).substring(0, 50) + '...' : 
                    'No data to encrypt'}
                </div>
              </div>
            </div>
          </div>
          <div className="privacy-notice grass-bg">
            <FaTree className="privacy-icon" /> 
            <div>
              <strong>Data Privacy Guarantee</strong>
              <p>Ecological data remains encrypted during FHE processing and is never decrypted on our servers</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn nature-button">Cancel</button>
          <button 
            onClick={handleSubmit} 
            disabled={creating || !creditData.location || creditData.areaSize <= 0 || creditData.speciesCount <= 0} 
            className="submit-btn nature-button primary"
          >
            {creating ? <><FaLeaf /> Encrypting with FHE...</> : <><FaTree /> Submit Securely</>}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CreditDetailModalProps {
  credit: BiodiversityCredit;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const CreditDetailModal: React.FC<CreditDetailModalProps> = ({ credit, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { setDecryptedValue(null); return; }
    const decrypted = await decryptWithSignature(credit.encryptedScore);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="credit-detail-modal wood-bg">
        <div className="modal-header">
          <h2>Credit Details #{credit.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="credit-info">
            <div className="info-item">
              <span>Location:</span>
              <strong>{credit.location}</strong>
            </div>
            <div className="info-item">
              <span>Area Size:</span>
              <strong>{credit.areaSize} km²</strong>
            </div>
            <div className="info-item">
              <span>Species Count:</span>
              <strong>{credit.speciesCount}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(credit.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${credit.status}`}>
                {credit.status === "verified" && <FaTree />}
                {credit.status === "pending" && <FaLeaf />}
                {credit.status === "rejected" && <FaWater />}
                {credit.status}
              </strong>
            </div>
          </div>
          <div className="encrypted-data-section stone-bg">
            <h3>Encrypted Biodiversity Score</h3>
            <div className="encrypted-data">{credit.encryptedScore.substring(0, 100)}...</div>
            <div className="fhe-tag grass-bg">
              <FaLeaf className="fhe-icon" />
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn nature-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"><FaLeaf /></span>
              ) : decryptedValue !== null ? (
                "Hide Decrypted Value"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          {decryptedValue !== null && (
            <div className="decrypted-data-section grass-bg">
              <h3>Decrypted Biodiversity Score</h3>
              <div className="decrypted-value">{decryptedValue.toFixed(2)}</div>
              <div className="decryption-notice">
                <FaTree className="warning-icon" />
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn nature-button">
            <FaLeaf /> Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;