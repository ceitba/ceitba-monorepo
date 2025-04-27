import express from "express";
import supabase from "../config/supabase";

const router = express.Router();

router.get<{ user_id: string }>("/:user_id", async (req, res): Promise<void> => {
    const { user_id } = req.params;
    const { data, error } = await supabase.schema("benefits")
        .from("inscription")
        .select("*")
        .eq("user_id", user_id);

    if (error) {
        res.status(500).json({ error: "Error fetching inscriptions. Error: "+error.message  });
        return;
    }

    res.json(data);
});

export default router;