import express from "express";
import supabase from "../../config/supabase";
import { ClassroomResponse,ClassroomData } from "./models";
const router = express.Router();


  
router.get("/classrooms", async (req, res) => {
    const { current_semester } = req.query;

    //Current semester toma segun la fecha de hoy, se podria cambiar para que tome la fecha del cuatrimestre mas cercano, ya que durante las vacaciones
    //se muestra la info de las clases de vacaciones nada mas.
    
    const {data,error} = await supabase.rpc('get_classrooms',{current_semester:current_semester ?? false});
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        const classroomsMap = (data as ClassroomResponse).reduce((acc, classroom) => {
            const building = classroom.building;
            if (!acc[building]) {
            acc[building] = [];
            }
            acc[building].push(classroom);
            return acc;
        }, {} as { [key: string]: ClassroomData[] });

        res.status(200).json(classroomsMap);

});
export default router;