import express from "express";
import supabase from "../../src/shared/config/supabase";
import inscriptionRouter from "./inscription";
const router = express.Router();
// Verificar si el usuario esta inscripto en la actividad
// 

router.use("/inscriptions/",inscriptionRouter);

export default router;