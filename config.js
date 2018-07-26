module.exports = {
  extends: 'lighthouse:default',
  settings: {
    onlyAudits: [
      'service-worker'
    ],
  },
};