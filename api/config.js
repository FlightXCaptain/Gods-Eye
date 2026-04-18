export default function handler(req, res) {
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.status(200).json({
    aisstreamKey: process.env.AISSTREAM_KEY || '',
  });
}
