import { Router, Request, Response, RequestHandler } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

// Path to whitelist files
const WHITELIST_PATH = process.env.WHITELIST_PATH || path.join(__dirname, '../../../whitelist.txt');
const WHITELIST_JSON_PATH = process.env.WHITELIST_JSON_PATH || path.join(__dirname, '../../../whitelist.json');

interface WhitelistBody {
  minecraftUsername: string;
  email: string;
}

interface WhitelistEntry {
  [email: string]: string; // email -> minecraft username mapping
}

const handleWhitelist: RequestHandler = async (req, res) => {
  try {
    const { minecraftUsername, email } = req.body as WhitelistBody;

    if (!minecraftUsername || !email) {
      res.status(400).json({ error: 'Nombre de usuario y email son requeridos' });
      return;
    }

    if (!email.endsWith('@itba.edu.ar')) {
      res.status(400).json({ error: 'Debe usar un email de ITBA' });
      return;
    }

    // Ensure both files exist
    try {
      await fs.access(WHITELIST_PATH);
      await fs.access(WHITELIST_JSON_PATH);
    } catch {
      await fs.writeFile(WHITELIST_PATH, '');
      await fs.writeFile(WHITELIST_JSON_PATH, '{}');
    }

    // Read whitelist JSON to check for duplicate emails
    const whitelistJsonContent = await fs.readFile(WHITELIST_JSON_PATH, 'utf-8');
    const whitelistEntries: WhitelistEntry = JSON.parse(whitelistJsonContent || '{}');

    // Check if email is already registered
    if (whitelistEntries[email]) {
      res.status(400).json({ error: 'Este email ya está registrado con otro usuario de Minecraft' });
      return;
    }

    // Read whitelist to check for duplicate usernames
    const whitelistContent = await fs.readFile(WHITELIST_PATH, 'utf-8');
    const usernames = whitelistContent.split('\n').filter(Boolean);

    // Check if username is already taken
    if (usernames.includes(minecraftUsername)) {
      res.status(400).json({ error: 'Este nombre de usuario de Minecraft ya está registrado' });
      return;
    }

    // Add the new entry to both files
    whitelistEntries[email] = minecraftUsername;
    await fs.writeFile(WHITELIST_JSON_PATH, JSON.stringify(whitelistEntries, null, 2));
    await fs.appendFile(WHITELIST_PATH, `${minecraftUsername}\n`);

    res.status(200).json({ message: 'Usuario agregado a la whitelist' });
  } catch (error) {
    console.error('Error updating whitelist:', error);
    res.status(500).json({ error: 'Error al agregar a la whitelist' });
  }
};

router.post('/whitelist', handleWhitelist);

export default router;
