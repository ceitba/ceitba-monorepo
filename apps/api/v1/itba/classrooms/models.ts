export type ClassroomResponse =ClassroomData[]

  
export interface ClassroomData {
    class_room: string
    building: string
    day: string
    hour_from: string
    hour_to: string
  }

export type ClassroomOutput = Map<string,ClassroomData[]>
