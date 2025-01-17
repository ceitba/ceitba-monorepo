import { Router, Request, Response } from 'express';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { validateRequest } from '../middleware/validateRequest';

const router = Router();

// Schema for request validation
const whitelistSchema = z.object({
  minecraftUsername: z.string().min(3).max(16),
  email: z.string().email(),
});

type WhitelistRequest = z.infer<typeof whitelistSchema>;

// Path to whitelist file - this should be configured in your environment variables
const WHITELIST_PATH = process.env.WHITELIST_PATH || path.join(__dirname, '../../../whitelist.txt');

router.post('/whitelist', validateRequest(whitelistSchema), (req: Request<{}, any, WhitelistRequest>, res: Response) => {
  (async () => {
    try {
      const { minecraftUsername } = req.body;
      
      // Ensure the file exists
      try {
        await fs.access(WHITELIST_PATH);
      } catch {
        // Create the file if it doesn't exist
        await fs.writeFile(WHITELIST_PATH, '');
      }

      // Read existing content to check for duplicates
      const content = await fs.readFile(WHITELIST_PATH, 'utf-8');
      const usernames = content.split('\n').filter(Boolean);

      // Check if username already exists
      if (usernames.includes(minecraftUsername)) {
        res.status(400).json({ error: 'Username already whitelisted' });
        return;
      }

      // Append the new username
      await fs.appendFile(WHITELIST_PATH, `${minecraftUsername}\n`);

      res.status(200).json({ message: 'Username added to whitelist' });
    } catch (error) {
      console.error('Error updating whitelist:', error);
      res.status(500).json({ error: 'Failed to update whitelist' });
    }
  })();
});

export default router;
