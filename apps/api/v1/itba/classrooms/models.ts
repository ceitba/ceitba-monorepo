export type ClassroomResponse =ClassroomData[]



  
export interface ClassroomData {
    class_room: string
    building: string
    day: string | null
    hour_from: string | null
    hour_to: string | null
  }

export type ClassroomOutput = Record<string,Map<string,ClassroomData[]>>
