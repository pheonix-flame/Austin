/* ==========================================================================
   EDIT YOUR PROJECTS HERE
   --------------------------------------------------------------------------
   Every card in "Selected work" and every row in "Community development"
   comes from the two lists below. To add a project, copy one of the { ... }
   blocks, paste it where you want it to appear, and change the text.
   Save the file and refresh the page; nothing else needs to change.

   Fields for `projects`:
     title     (required)  Card heading
     tag       (required)  Small label above the title, e.g. "Security tooling"
     summary   (required)  Main paragraph. You can use <b>bold</b>.
     note      (optional)  Smaller grey line under the summary
     chips     (optional)  List of short technology labels
     link      (optional)  { url: "https://...", label: "Visit site" }
     status    (optional)  Small badge, e.g. 'Coming soon' or 'In progress'
     featured  (optional)  true = large card with the score demo (use once)

   Fields for `community`:
     title, summary (required); url (optional; leave it out for internal tools)
   ========================================================================== */

export const projects = [
  {
    featured: true,
    tag: 'Security tooling · SAST',
    title: 'Oracle APEX security scanner',
    summary:
      'A static application security testing (SAST) tool for Oracle APEX and other low-code applications. ' +
      'It exists so teams can confirm their low-code apps are not vulnerable before they ship. Checks follow the ' +
      '<b>OWASP Top 10</b>: SQL injection in dynamic SQL, XSS escaping gaps, broken access control (missing ' +
      'authorization schemes), weak session-state protection, hardcoded credentials and risky database object ' +
      'dependencies. Every application gets a 0–100 score weighted by severity.',
    note: 'Runs without SYS/ADMIN privileges, so developers can scan their own work.',
    chips: ['Oracle APEX', 'PL/SQL', 'SAST', 'OWASP Top 10'],
  },
  {
    tag: 'Machine learning · Forex',
    title: 'Quantora v1',
    summary:
      'My BSc final-year project: optimising forex trades with <b>LSTM</b> networks and other machine-learning ' +
      'models. It forecasts short-horizon price movement from historical market data and uses the signals to ' +
      'time entries and exits, with performance measured against baseline strategies.',
    chips: ['Python', 'LSTM', 'TensorFlow', 'scikit-learn', 'Forex'],
  },
  {
    tag: 'Quantora',
    title: 'Quantora Sentinel',
    status: 'Coming soon',
    summary: 'The next chapter of Quantora. Details soon.',
    chips: ['In development'],
  },
  {
    tag: 'AI · Data',
    title: 'RAG applications & MCP servers',
    summary:
      'Retrieval-augmented generation apps and Model Context Protocol servers that connect AI assistants to ' +
      'enterprise data, with access control kept where it belongs: in the data layer.',
    chips: ['Python', 'LLMs', 'Oracle Select AI'],
  },
  {
    tag: 'Security · Developer tooling',
    title: 'Secure SAP database viewer',
    summary:
      'A lightweight, browser-based viewer that gives the internal development team secure access to SAP ' +
      'database data, without installing database clients or handing out direct database credentials.',
    chips: ['SAP HANA', 'Web app', 'Access control', 'Internal tooling'],
  },
  {
    tag: 'Enterprise',
    title: 'Group-wide helpdesk',
    summary:
      'Ticketing across every Tolaram entity, with secure REST APIs using API-key authentication, environment ' +
      'isolation and transactional rollback for automated RPA integrations.',
    chips: ['REST', 'API security', 'RPA'],
  },
  {
    tag: 'Finance systems',
    title: 'Reconciliation & audit tooling',
    summary:
      'Automated intercompany reconciliation, trial balance and inventory tracking, plus read-only audit tools ' +
      'for POS-to-SAP sales and discount data, for a faster and more accurate period-end close.',
    chips: ['SAP HANA', 'SQL', 'Internal controls'],
  },
  {
    tag: 'Controls',
    title: 'Audit trails & approval workflows',
    summary:
      'Trigger-based audit trails for SAP customer and supplier block/unblock requests, logging every change end ' +
      'to end. Multi-level sign-off for BOM production-version unlocks and GL account creation.',
    chips: ['Triggers', 'Workflow', 'Change mgmt'],
  },
  {
    tag: 'Machine learning',
    title: 'Item similarity model',
    summary:
      'A similarity model behind product search that improved relevance by <b>35%</b> and cut category ' +
      'mismatches by <b>20%</b>.',
    chips: ['scikit-learn', 'Embeddings'],
  },
  {
    tag: 'Manufacturing',
    title: 'Product weighing & line monitoring',
    summary:
      'A weighing application that raised accuracy by <b>25%</b> and removed <b>80%</b> of manual entry, plus ' +
      'real-time machine-data visualisations that improved production monitoring by 20%.',
    chips: ['Machine data', 'Dashboards'],
  },
  {
    tag: 'Quant',
    title: 'Systematic trading & risk',
    summary:
      'Backtested and deployed strategies on MetaTrader 5, statistical-arbitrage models and automated execution: ' +
      'Sharpe from 1.1 to 1.65, slippage down 3.5 bps. VaR and Monte Carlo risk models.',
    chips: ['Python', 'MT5', 'Monte Carlo'],
  },
];

export const community = [
  {
    title: 'Editorial CDS Lagos website',
    summary: 'Designed for NYSC Lagos to improve community engagement and make information easier to find.',
    url: 'https://editorial-cds-lagos.vercel.app/',
  },
  {
    title: 'Special CDS attendance management',
    summary: 'A web-based system for NYSC Lagos to track attendance for special CDS members.',
  },
  {
    title: 'NACOS dues payment platform',
    summary:
      "Led a student team building online dues payment and record-keeping for the computing students' association.",
    url: 'https://nacosfunaab.com.ng/pay',
  },
];
