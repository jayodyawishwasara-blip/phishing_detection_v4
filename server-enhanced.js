const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { createObjectCsvWriter } = require('csv-writer');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const Jimp = require('jimp');
const natural = require('natural');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

const app = express();
const PORT = 5000;

// Configuration
const CONFIG = {
  dataFolder: path.join(process.cwd(), 'phishing-data'),
  logsFolder: path.join(process.cwd(), 'phishing-data', 'logs'),
  screenshotsFolder: path.join(process.cwd(), 'phishing-data', 'screenshots'),
  domainsFolder: path.join(process.cwd(), 'phishing-data', 'domains'),
  baselineFolder: path.join(process.cwd(), 'phishing-data', 'baseline'),
  legitimateDomain: 'combankdigital.com',
  refreshInterval: 3600000, // 1 hour
  whitelist: ['combankdigital.com', 'combank.com', 'combank.lk'],
  thresholds: {
    critical: 85,    // High confidence phishing
    warning: 70,     // Suspicious, needs review
    suspicious: 55   // Low confidence, monitor
  }
};

// Middleware
app.use(cors());
app.use(express.json());

// Initialize directories
async function initializeDirectories() {
  const dirs = [
    CONFIG.dataFolder,
    CONFIG.logsFolder,
    CONFIG.screenshotsFolder,
    CONFIG.domainsFolder,
    CONFIG.baselineFolder
  ];

  for (const dir of dirs) {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
      console.log(`✓ Created directory: ${dir}`);
    }
  }
}

// ========================================
// BASELINE MANAGEMENT
// ========================================

class BaselineManager {
  constructor() {
    this.baseline = null;
    this.lastUpdate = null;
  }

  async crawlLegitimateWebsite(domain) {
    console.log(`\n📡 Crawling baseline website: ${domain}`);
    
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      
      // Navigate to page
      await page.goto(`https://${domain}`, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });

      // Wait for JavaScript to render
      await page.waitForTimeout(2000);

      // Extract comprehensive data
      const data = await page.evaluate(() => {
        // Remove dynamic content markers
        const removeTimestamps = (text) => {
          return text
            .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE')
            .replace(/\d{2}:\d{2}:\d{2}/g, 'TIME')
            .replace(/\d{13,}/g, 'TIMESTAMP')
            .replace(/[a-f0-9]{32,}/gi, 'HASH');
        };

        // Get visible text
        const bodyText = document.body.innerText || '';
        const normalizedText = removeTimestamps(bodyText);

        // Extract brand keywords
        const keywords = [];
        const keywordElements = document.querySelectorAll('h1, h2, h3, .logo, .brand, #logo, [class*="logo"], [class*="brand"]');
        keywordElements.forEach(el => {
          if (el.textContent.trim()) {
            keywords.push(el.textContent.trim().toLowerCase());
          }
        });

        // Extract form fields
        const forms = [];
        document.querySelectorAll('form').forEach(form => {
          const fields = [];
          form.querySelectorAll('input, select, textarea').forEach(input => {
            fields.push({
              type: input.type || input.tagName.toLowerCase(),
              name: input.name,
              id: input.id,
              placeholder: input.placeholder
            });
          });
          forms.push({ fields, action: form.action });
        });

        // Get DOM structure (simplified)
        const getDOMStructure = (node, depth = 0) => {
          if (depth > 5) return null;
          const structure = {
            tag: node.tagName,
            classes: Array.from(node.classList || []),
            id: node.id
          };
          if (node.children.length > 0 && depth < 5) {
            structure.children = Array.from(node.children)
              .slice(0, 10)
              .map(child => getDOMStructure(child, depth + 1))
              .filter(Boolean);
          }
          return structure;
        };

        const domStructure = getDOMStructure(document.body);

        // Extract meta information
        const meta = {
          title: document.title,
          description: document.querySelector('meta[name="description"]')?.content || '',
          keywords: document.querySelector('meta[name="keywords"]')?.content || ''
        };

        // Get all links
        const links = Array.from(document.querySelectorAll('a')).map(a => a.href);

        return {
          text: normalizedText,
          keywords: [...new Set(keywords)],
          forms,
          domStructure,
          meta,
          links: links.slice(0, 50)
        };
      });

      // Capture screenshot
      const screenshotPath = path.join(CONFIG.baselineFolder, `baseline_${Date.now()}.png`);
      await page.screenshot({ 
        path: screenshotPath,
        fullPage: false  // Just above the fold
      });

      // Get HTML
      const html = await page.content();

      const baseline = {
        domain,
        timestamp: new Date().toISOString(),
        data,
        html,
        screenshotPath,
        textHash: this.hashContent(data.text),
        domHash: this.hashContent(JSON.stringify(data.domStructure))
      };

      // Save baseline
      await fs.writeFile(
        path.join(CONFIG.baselineFolder, 'baseline.json'),
        JSON.stringify(baseline, null, 2)
      );

      console.log(`✓ Baseline captured: ${Object.keys(data).length} features extracted`);
      return baseline;

    } catch (error) {
      console.error(`✗ Baseline capture failed:`, error.message);
      return null;
    } finally {
      if (browser) await browser.close();
    }
  }

  async loadBaseline() {
    try {
      const baselinePath = path.join(CONFIG.baselineFolder, 'baseline.json');
      const content = await fs.readFile(baselinePath, 'utf8');
      this.baseline = JSON.parse(content);
      this.lastUpdate = new Date(this.baseline.timestamp);
      console.log(`✓ Baseline loaded: ${this.lastUpdate.toLocaleString()}`);
      return this.baseline;
    } catch {
      console.log(`⚠ No baseline found, creating new...`);
      return await this.refreshBaseline();
    }
  }

  async refreshBaseline() {
    this.baseline = await this.crawlLegitimateWebsite(CONFIG.legitimateDomain);
    this.lastUpdate = new Date();
    return this.baseline;
  }

  async ensureFreshBaseline() {
    if (!this.baseline || !this.lastUpdate) {
      await this.loadBaseline();
    }

    const age = Date.now() - this.lastUpdate.getTime();
    if (age > CONFIG.refreshInterval) {
      console.log(`⟳ Baseline is ${Math.round(age / 60000)} minutes old, refreshing...`);
      await this.refreshBaseline();
    }

    return this.baseline;
  }

  hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

const baselineManager = new BaselineManager();

// ========================================
// PHISHING DETECTION ENGINE
// ========================================

class PhishingDetector {
  constructor(baseline) {
    this.baseline = baseline;
    this.TfIdf = natural.TfIdf;
    this.tfidf = new this.TfIdf();
  }

  // 1. TEXT SIMILARITY (25% weight)
  calculateTextSimilarity(suspiciousText) {
    if (!this.baseline || !suspiciousText) return 0;

    const baselineText = this.baseline.data.text;
    
    // Use TF-IDF for semantic similarity
    this.tfidf.addDocument(baselineText);
    this.tfidf.addDocument(suspiciousText);

    // Calculate cosine similarity
    const terms = new Set([
      ...baselineText.split(/\s+/),
      ...suspiciousText.split(/\s+/)
    ]);

    let dotProduct = 0;
    let baseMagnitude = 0;
    let suspMagnitude = 0;

    terms.forEach(term => {
      const baseTfidf = this.tfidf.tfidf(term, 0);
      const suspTfidf = this.tfidf.tfidf(term, 1);
      
      dotProduct += baseTfidf * suspTfidf;
      baseMagnitude += baseTfidf * baseTfidf;
      suspMagnitude += suspTfidf * suspTfidf;
    });

    const cosineSim = dotProduct / (Math.sqrt(baseMagnitude) * Math.sqrt(suspMagnitude));
    return Math.min(100, Math.max(0, cosineSim * 100));
  }

  // 2. BRAND KEYWORD MATCHING (15% weight)
  calculateKeywordSimilarity(suspiciousData) {
    if (!this.baseline || !suspiciousData) return 0;

    const baselineKeywords = this.baseline.data.keywords.map(k => k.toLowerCase());
    const suspiciousText = suspiciousData.text.toLowerCase();

    let matches = 0;
    let total = baselineKeywords.length;

    baselineKeywords.forEach(keyword => {
      if (suspiciousText.includes(keyword)) {
        matches++;
      }
    });

    return total > 0 ? (matches / total) * 100 : 0;
  }

  // 3. DOM STRUCTURE SIMILARITY (20% weight)
  calculateDOMSimilarity(suspiciousDom) {
    if (!this.baseline || !suspiciousDom) return 0;

    const baseDom = this.baseline.data.domStructure;
    
    const similarity = this.compareDOMTrees(baseDom, suspiciousDom);
    return similarity * 100;
  }

  compareDOMTrees(tree1, tree2, depth = 0) {
    if (!tree1 || !tree2) return 0;
    if (depth > 5) return 0.5; // Max depth

    let score = 0;
    let comparisons = 0;

    // Compare tags
    if (tree1.tag === tree2.tag) {
      score += 1;
    }
    comparisons++;

    // Compare classes
    if (tree1.classes && tree2.classes) {
      const intersection = tree1.classes.filter(c => tree2.classes.includes(c));
      const union = [...new Set([...tree1.classes, ...tree2.classes])];
      score += union.length > 0 ? intersection.length / union.length : 0;
      comparisons++;
    }

    // Compare children
    if (tree1.children && tree2.children) {
      const minLength = Math.min(tree1.children.length, tree2.children.length);
      for (let i = 0; i < minLength; i++) {
        score += this.compareDOMTrees(tree1.children[i], tree2.children[i], depth + 1);
        comparisons++;
      }
    }

    return comparisons > 0 ? score / comparisons : 0;
  }

  // 4. FORM SIMILARITY (10% weight)
  calculateFormSimilarity(suspiciousForms) {
    if (!this.baseline || !suspiciousForms || suspiciousForms.length === 0) return 0;

    const baselineForms = this.baseline.data.forms;
    if (baselineForms.length === 0) return 0;

    let maxSimilarity = 0;

    baselineForms.forEach(baseForm => {
      suspiciousForms.forEach(suspForm => {
        const similarity = this.compareFormFields(baseForm.fields, suspForm.fields);
        maxSimilarity = Math.max(maxSimilarity, similarity);
      });
    });

    return maxSimilarity * 100;
  }

  compareFormFields(fields1, fields2) {
    if (fields1.length === 0 && fields2.length === 0) return 0;

    let matches = 0;
    const total = Math.max(fields1.length, fields2.length);

    fields1.forEach(f1 => {
      const found = fields2.find(f2 => 
        f2.type === f1.type && 
        (f2.name === f1.name || f2.id === f1.id || f2.placeholder === f1.placeholder)
      );
      if (found) matches++;
    });

    return total > 0 ? matches / total : 0;
  }

  // 5. VISUAL SIMILARITY (30% weight) - Perceptual Hash
  async calculateVisualSimilarity(baselineScreenshot, suspiciousScreenshot) {
    try {
      const img1 = await Jimp.read(baselineScreenshot);
      const img2 = await Jimp.read(suspiciousScreenshot);

      // Resize to same dimensions
      const width = 256;
      const height = 256;
      img1.resize(width, height);
      img2.resize(height, height);

      // Convert to PNG buffers
      const buf1 = await img1.getBufferAsync(Jimp.MIME_PNG);
      const buf2 = await img2.getBufferAsync(Jimp.MIME_PNG);

      const png1 = PNG.sync.read(buf1);
      const png2 = PNG.sync.read(buf2);

      // Calculate pixel difference
      const diff = new PNG({ width, height });
      const numDiffPixels = pixelmatch(
        png1.data, png2.data, diff.data,
        width, height,
        { threshold: 0.1 }
      );

      const totalPixels = width * height;
      const similarity = (1 - numDiffPixels / totalPixels) * 100;

      return Math.max(0, similarity);

    } catch (error) {
      console.error('Visual comparison failed:', error.message);
      return 0;
    }
  }

  // COMPOSITE SCORING with weighted average
  calculateCompositeScore(scores) {
    const weights = {
      visual: 0.30,
      text: 0.25,
      dom: 0.20,
      keywords: 0.15,
      forms: 0.10
    };

    const composite = (
      scores.visual * weights.visual +
      scores.text * weights.text +
      scores.dom * weights.dom +
      scores.keywords * weights.keywords +
      scores.forms * weights.forms
    );

    return Math.round(composite);
  }

  // FALSE POSITIVE FILTERING
  async filterFalsePositives(domain, data, scores) {
    const filters = [];

    // 1. Whitelist check
    if (CONFIG.whitelist.some(d => domain.includes(d))) {
      filters.push({ type: 'whitelist', reason: 'Domain is whitelisted', confidence: 100 });
      return { isFiltered: true, filters };
    }

    // 2. Content type detection
    const text = data.text.toLowerCase();
    const contentTypes = [
      { type: 'news', keywords: ['article', 'published', 'author', 'news', 'reported'], threshold: 3 },
      { type: 'review', keywords: ['review', 'rating', 'customer', 'feedback', 'opinion'], threshold: 3 },
      { type: 'forum', keywords: ['forum', 'discussion', 'thread', 'posted by', 'reply'], threshold: 3 },
      { type: 'blog', keywords: ['blog', 'posted', 'comments', 'written by'], threshold: 2 }
    ];

    for (const ct of contentTypes) {
      const matches = ct.keywords.filter(kw => text.includes(kw)).length;
      if (matches >= ct.threshold) {
        filters.push({
          type: 'content_type',
          reason: `Appears to be a ${ct.type} site mentioning the brand`,
          confidence: (matches / ct.keywords.length) * 100
        });
      }
    }

    // 3. Contextual keywords (about us, review, etc)
    const contextualKeywords = [
      'about', 'review of', 'comparison', 'vs', 'versus', 
      'what is', 'how to use', 'guide to', 'analysis of'
    ];
    const contextMatches = contextualKeywords.filter(kw => text.includes(kw)).length;
    if (contextMatches >= 2) {
      filters.push({
        type: 'contextual',
        reason: 'Content appears to be informational/editorial',
        confidence: (contextMatches / contextualKeywords.length) * 100
      });
    }

    // 4. Low form similarity with high text similarity = likely article
    if (scores.forms < 20 && scores.text > 60 && scores.visual < 50) {
      filters.push({
        type: 'pattern',
        reason: 'Text mentions brand but lacks login forms - likely news/review',
        confidence: 75
      });
    }

    const isFiltered = filters.length > 0 && filters.some(f => f.confidence > 70);
    return { isFiltered, filters };
  }

  // Determine threat level
  determineThreatLevel(compositeScore, filters) {
    if (filters.isFiltered) {
      return 'legitimate';
    }

    if (compositeScore >= CONFIG.thresholds.critical) {
      return 'critical';
    } else if (compositeScore >= CONFIG.thresholds.warning) {
      return 'warning';
    } else if (compositeScore >= CONFIG.thresholds.suspicious) {
      return 'suspicious';
    } else {
      return 'safe';
    }
  }
}

// ========================================
// ENHANCED DOMAIN CHECKING
// ========================================

async function checkDomainWithRealDetection(domain) {
  console.log(`\n🔍 Analyzing domain: ${domain}`);

  let browser;
  try {
    // Ensure baseline is fresh
    const baseline = await baselineManager.ensureFreshBaseline();
    
    if (!baseline) {
      throw new Error('No baseline available');
    }

    // Launch browser
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Try to fetch the suspicious domain
    let isActive = false;
    let suspiciousData = null;
    let screenshotPath = null;

    try {
      await page.goto(`http://${domain}`, {
        waitUntil: 'networkidle2',
        timeout: 15000
      });
      
      await page.waitForTimeout(2000);
      isActive = true;

      // Extract data (same as baseline)
      suspiciousData = await page.evaluate(() => {
        const removeTimestamps = (text) => {
          return text
            .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE')
            .replace(/\d{2}:\d{2}:\d{2}/g, 'TIME')
            .replace(/\d{13,}/g, 'TIMESTAMP')
            .replace(/[a-f0-9]{32,}/gi, 'HASH');
        };

        const bodyText = document.body.innerText || '';
        const normalizedText = removeTimestamps(bodyText);

        const keywords = [];
        const keywordElements = document.querySelectorAll('h1, h2, h3, .logo, .brand, #logo');
        keywordElements.forEach(el => {
          if (el.textContent.trim()) {
            keywords.push(el.textContent.trim().toLowerCase());
          }
        });

        const forms = [];
        document.querySelectorAll('form').forEach(form => {
          const fields = [];
          form.querySelectorAll('input, select, textarea').forEach(input => {
            fields.push({
              type: input.type || input.tagName.toLowerCase(),
              name: input.name,
              id: input.id,
              placeholder: input.placeholder
            });
          });
          forms.push({ fields, action: form.action });
        });

        const getDOMStructure = (node, depth = 0) => {
          if (depth > 5) return null;
          const structure = {
            tag: node.tagName,
            classes: Array.from(node.classList || []),
            id: node.id
          };
          if (node.children.length > 0 && depth < 5) {
            structure.children = Array.from(node.children)
              .slice(0, 10)
              .map(child => getDOMStructure(child, depth + 1))
              .filter(Boolean);
          }
          return structure;
        };

        return {
          text: normalizedText,
          keywords,
          forms,
          domStructure: getDOMStructure(document.body)
        };
      });

      // Capture screenshot
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${safeDomain}_${timestamp}.png`;
      screenshotPath = path.join(CONFIG.screenshotsFolder, filename);
      
      await page.screenshot({ 
        path: screenshotPath,
        fullPage: false
      });

      console.log(`✓ Data extracted from ${domain}`);

    } catch (error) {
      console.log(`✓ Domain is inactive or unreachable`);
      isActive = false;
    }

    // If inactive, return early
    if (!isActive) {
      return {
        isActive: false,
        similarity: 0,
        scores: {},
        threatLevel: 'safe',
        screenshotPath: null
      };
    }

    // Run detection
    const detector = new PhishingDetector(baseline);

    console.log(`  → Calculating text similarity...`);
    const textScore = detector.calculateTextSimilarity(suspiciousData.text);

    console.log(`  → Checking brand keywords...`);
    const keywordScore = detector.calculateKeywordSimilarity(suspiciousData);

    console.log(`  → Analyzing DOM structure...`);
    const domScore = detector.calculateDOMSimilarity(suspiciousData.domStructure);

    console.log(`  → Comparing form fields...`);
    const formScore = detector.calculateFormSimilarity(suspiciousData.forms);

    console.log(`  → Running visual comparison...`);
    const visualScore = await detector.calculateVisualSimilarity(
      baseline.screenshotPath,
      screenshotPath
    );

    const scores = {
      text: Math.round(textScore),
      keywords: Math.round(keywordScore),
      dom: Math.round(domScore),
      forms: Math.round(formScore),
      visual: Math.round(visualScore)
    };

    const compositeScore = detector.calculateCompositeScore(scores);

    console.log(`  → Filtering false positives...`);
    const filters = await detector.filterFalsePositives(domain, suspiciousData, scores);

    const threatLevel = detector.determineThreatLevel(compositeScore, filters);

    const result = {
      isActive: true,
      similarity: compositeScore,
      scores,
      threatLevel,
      screenshotPath: path.basename(screenshotPath),
      filters: filters.filters,
      isFiltered: filters.isFiltered
    };

    console.log(`✓ Analysis complete: ${compositeScore}% similarity (${threatLevel})`);
    
    return result;

  } catch (error) {
    console.error(`✗ Domain check failed:`, error.message);
    return {
      isActive: false,
      similarity: 0,
      error: error.message
    };
  } finally {
    if (browser) await browser.close();
  }
}

// ========================================
// CSV LOGGING
// ========================================

function getCurrentLogPath() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  
  const filename = `log_${year}-${month}-${day}_${hour}00.csv`;
  return path.join(CONFIG.logsFolder, filename);
}

async function ensureLogFile() {
  const logPath = getCurrentLogPath();
  
  try {
    await fs.access(logPath);
  } catch {
    const csvWriter = createObjectCsvWriter({
      path: logPath,
      header: [
        { id: 'timestamp', title: 'Timestamp' },
        { id: 'domain', title: 'Domain' },
        { id: 'alertType', title: 'Alert Type' },
        { id: 'status', title: 'Status' },
        { id: 'isActive', title: 'Is Active' },
        { id: 'compositeScore', title: 'Composite Score (%)' },
        { id: 'textScore', title: 'Text Score (%)' },
        { id: 'visualScore', title: 'Visual Score (%)' },
        { id: 'domScore', title: 'DOM Score (%)' },
        { id: 'keywordScore', title: 'Keyword Score (%)' },
        { id: 'formScore', title: 'Form Score (%)' },
        { id: 'threatLevel', title: 'Threat Level' },
        { id: 'isFiltered', title: 'Filtered as False Positive' },
        { id: 'screenshotPath', title: 'Screenshot Path' },
        { id: 'metadata', title: 'Metadata' }
      ]
    });
    
    await csvWriter.writeRecords([]);
    console.log(`Created new log file: ${logPath}`);
  }
}

async function logToCSV(data) {
  await ensureLogFile();
  const logPath = getCurrentLogPath();
  
  const csvWriter = createObjectCsvWriter({
    path: logPath,
    header: [
      { id: 'timestamp', title: 'Timestamp' },
      { id: 'domain', title: 'Domain' },
      { id: 'alertType', title: 'Alert Type' },
      { id: 'status', title: 'Status' },
      { id: 'isActive', title: 'Is Active' },
      { id: 'compositeScore', title: 'Composite Score (%)' },
      { id: 'textScore', title: 'Text Score (%)' },
      { id: 'visualScore', title: 'Visual Score (%)' },
      { id: 'domScore', title: 'DOM Score (%)' },
      { id: 'keywordScore', title: 'Keyword Score (%)' },
      { id: 'formScore', title: 'Form Score (%)' },
      { id: 'threatLevel', title: 'Threat Level' },
      { id: 'isFiltered', title: 'Filtered as False Positive' },
      { id: 'screenshotPath', title: 'Screenshot Path' },
      { id: 'metadata', title: 'Metadata' }
    ],
    append: true
  });

  await csvWriter.writeRecords([{
    timestamp: data.timestamp || new Date().toISOString(),
    domain: data.domain || '',
    alertType: data.alertType || 'Check',
    status: data.status || 'Checked',
    isActive: data.isActive ? 'Yes' : 'No',
    compositeScore: data.compositeScore || 0,
    textScore: data.scores?.text || 0,
    visualScore: data.scores?.visual || 0,
    domScore: data.scores?.dom || 0,
    keywordScore: data.scores?.keywords || 0,
    formScore: data.scores?.forms || 0,
    threatLevel: data.threatLevel || 'unknown',
    isFiltered: data.isFiltered ? 'Yes' : 'No',
    screenshotPath: data.screenshotPath || '',
    metadata: data.metadata || ''
  }]);
}

// ========================================
// API ROUTES
// ========================================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    baseline: baselineManager.baseline ? 'loaded' : 'not loaded',
    lastUpdate: baselineManager.lastUpdate
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    ...CONFIG,
    baselineAge: baselineManager.lastUpdate ? 
      Math.round((Date.now() - baselineManager.lastUpdate.getTime()) / 60000) + ' minutes' : 
      'unknown'
  });
});

app.post('/api/check-domain', async (req, res) => {
  const { domain } = req.body;

  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }

  try {
    const result = await checkDomainWithRealDetection(domain);

    // Log to CSV
    await logToCSV({
      domain,
      alertType: result.threatLevel === 'critical' ? 'Critical' :
                 result.threatLevel === 'warning' ? 'Warning' : 'Check',
      status: 'Checked',
      isActive: result.isActive,
      compositeScore: result.similarity,
      scores: result.scores,
      threatLevel: result.threatLevel,
      isFiltered: result.isFiltered,
      screenshotPath: result.screenshotPath || ''
    });

    res.json(result);
  } catch (error) {
    console.error('Domain check error:', error);
    res.status(500).json({ error: 'Domain check failed' });
  }
});

// Refresh baseline manually
app.post('/api/refresh-baseline', async (req, res) => {
  try {
    const baseline = await baselineManager.refreshBaseline();
    res.json({ 
      success: true,
      timestamp: baseline.timestamp
    });
  } catch (error) {
    res.status(500).json({ error: 'Baseline refresh failed' });
  }
});

app.get('/api/historical', async (req, res) => {
  try {
    const domainDirs = await fs.readdir(CONFIG.domainsFolder);
    const allHistory = [];

    for (const domainDir of domainDirs) {
      const historyFile = path.join(CONFIG.domainsFolder, domainDir, 'history.json');
      
      try {
        const content = await fs.readFile(historyFile, 'utf8');
        const history = JSON.parse(content);
        
        history.forEach(record => {
          allHistory.push({
            domain: domainDir.replace(/_/g, '.'),
            ...record
          });
        });
      } catch {}
    }

    allHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(allHistory);
  } catch (error) {
    res.json([]);
  }
});

app.get('/api/screenshot/:filename', async (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(CONFIG.screenshotsFolder, filename);

  try {
    await fs.access(filePath);
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'Screenshot not found' });
  }
});

app.post('/api/log-alert', async (req, res) => {
  const alertData = req.body;
  try {
    await logToCSV({
      domain: alertData.domain,
      alertType: alertData.severity === 'critical' ? 'Critical' : 'Warning',
      status: 'Alert Triggered',
      isActive: true,
      compositeScore: alertData.similarity,
      scores: alertData.scores || {},
      threatLevel: alertData.threatLevel,
      screenshotPath: alertData.screenshotPath || '',
      metadata: JSON.stringify({ detectedAt: alertData.detectedAt })
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to log alert' });
  }
});

app.delete('/api/watchlist/:domain', async (req, res) => {
  const { domain } = req.params;
  await logToCSV({
    domain,
    alertType: 'Info',
    status: 'Removed from Watchlist',
    isActive: false,
    compositeScore: 0
  });
  res.json({ success: true });
});

// Initialize and start server
async function startServer() {
  await initializeDirectories();
  
  // Load or create baseline
  console.log('\n🔧 Initializing Phishing Detection Engine...');
  await baselineManager.loadBaseline();
  
  app.listen(PORT, () => {
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   ✨ Enhanced Phishing Defense Backend');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`   Status: ONLINE`);
    console.log(`   Port: ${PORT}`);
    console.log(`   URL: http://localhost:${PORT}`);
    console.log('');
    console.log('   🎯 Detection Methods:');
    console.log('   ✓ Text Similarity (TF-IDF) - 25%');
    console.log('   ✓ Visual Comparison (Perceptual Hash) - 30%');
    console.log('   ✓ DOM Structure Analysis - 20%');
    console.log('   ✓ Brand Keyword Matching - 15%');
    console.log('   ✓ Form Field Comparison - 10%');
    console.log('');
    console.log('   🛡️ False Positive Filtering:');
    console.log('   ✓ Whitelist checking');
    console.log('   ✓ Content type detection');
    console.log('   ✓ Contextual analysis');
    console.log('');
    console.log('   📊 Thresholds:');
    console.log(`   • Critical: ${CONFIG.thresholds.critical}%`);
    console.log(`   • Warning: ${CONFIG.thresholds.warning}%`);
    console.log(`   • Suspicious: ${CONFIG.thresholds.suspicious}%`);
    console.log('');
    console.log(`   ⟳ Baseline: ${baselineManager.lastUpdate ? baselineManager.lastUpdate.toLocaleString() : 'Not loaded'}`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
  });
}

startServer().catch(console.error);
