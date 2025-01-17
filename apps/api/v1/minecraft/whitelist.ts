import { Router, Request, Response, RequestHandler } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

// Path to whitelist file - this should be configured in your environment variables
const WHITELIST_PATH = process.env.WHITELIST_PATH || path.join(__dirname, '../../../whitelist.txt');
interface WhitelistBody {
  minecraftUsername: string;
  email: string;
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
    } catch {
      await fs.writeFile(WHITELIST_PATH, '');
    }

    // Read whitelist to check for duplicate usernames
    const whitelistContent = await fs.readFile(WHITELIST_PATH, 'utf-8');
    const usernames = whitelistContent.split('\n').filter(Boolean);

    // Check if username is already taken
    if (usernames.includes(minecraftUsername)) {
      res.status(400).json({ error: 'Este nombre de usuario de Minecraft ya está registrado' });
      return;
    }

    // Append the new username to whitelist
    await fs.appendFile(WHITELIST_PATH, `${minecraftUsername}\n`);

    res.status(200).json({ message: 'Usuario agregado a la whitelist' });
  } catch (error) {
    console.error('Error updating whitelist:', error);
    res.status(500).json({ error: 'Error al agregar a la whitelist' });
  }
};

router.post('/whitelist', handleWhitelist);

export default router;
