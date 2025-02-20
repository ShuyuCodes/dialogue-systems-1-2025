import { assign, createActor, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { createBrowserInspector } from "@statelyai/inspect";
import { KEY } from "./azure";
import { DMContext, DMEvents } from "./types";

const inspector = createBrowserInspector();

const azureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: "northeurope",
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

interface GrammarEntry {
  person?: string;
  day?: string;
  time?: string;
  confirmation?: string; // Whether the meeting is for the whole day
}

// Define the grammar for recognizing relevant words and phrases
const grammar: { [index: string]: GrammarEntry } = {
  // People
  vlad: { person: "Vladislav Maraev" },
  aya: { person: "Nayat Astaiza Soriano" },
  victoria: { person: "Victoria Daniilidou" },

  // Days
  monday: { day: "Monday" },
  tuesday: { day: "Tuesday" },
  wednesday: { day: "Wednesday" },
  thursday: { day: "Thursday" },
  friday: { day: "Friday" },

  // Times
  "9": { time: "09:00" },
  "10": { time: "10:00" },
  "11": { time: "11:00" },
  "12": { time: "12:00" },
  "13": { time: "13:00" },
  "14": { time: "14:00" },
  "15": { time: "15:00" },
  "16": { time: "16:00" },
  "17": { time: "17:00" },
  "18": { time: "18:00" },

  // Confirmation
  yes: { confirmation: "yes" },
  no: { confirmation: "no" },
  "whole day": { confirmation: "yes" },
  "of course": { confirmation: "yes" },
};

function isInGrammar(utterance: string) {
  return utterance.toLowerCase() in grammar;
}

function getPerson(utterance: string) {
  return (grammar[utterance.toLowerCase()] || {}).person;
}
// Add helper function to extract information 

function getDay(utterance: string) {
  return (grammar[utterance.toLowerCase()] || {}).day;
}

function getTime(utterance: string) {
  return (grammar[utterance.toLowerCase()] || {}).time;
}

function getConfirmation(utterance: string) {
  return (grammar[utterance.toLowerCase()] || {}).confirmation;
}

const dmMachine = setup({
  types: {
    /** you might need to extend these */
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    /** define your actions here */
    "spst.speak": ({ context }, params: { utterance: string }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: {
          utterance: params.utterance,
        },
      }),
    "spst.listen": ({ context }) =>
      context.spstRef.send({
        type: "LISTEN",
      }),
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    appointment: {
      person: null,
      day: null,
      time: null,
      confirmation: null,
    },
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: { CLICK: "Greeting" },
    },
    Greeting: {
      entry: ({context, event}) => console.log("dfdsfdfdsfsd", context, event),
      initial: "Createconversation",
      on: {
        LISTEN_COMPLETE: [
          {
            target: "CheckGrammar",
            guard: ({ context }) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ],
      },
      states: {
        // start the conversation
        Createconversation: {
          entry: { type: "spst.speak", params: { utterance: `Let's create an appointment! ` } },
          on: { SPEAK_COMPLETE: "AskPerson" },
        },

        AskPerson: {
          entry: { type: "spst.speak", params: { utterance: `Who are you meeting with?` } },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! Who are you meeting with?` },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },
        Ask: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({ event }) => {
                return { lastResult: event.value };
              }),
            },
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }),
            },
          },
        },
      },
    },
    // CheckGrammar: {
    //   entry: {
    //     type: "spst.speak",
    //     params: ({ context }) => ({
    //       utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
    //         isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
    //       } in your given list.`,
    //     }),
    //   },
    //   on: { SPEAK_COMPLETE: "Step2AskDay" },
    //   // check if name is in the list:
    //   // in the list -> go Step2AskDay && assign the name to name property
    //   // not in the list -> go back to AskPerson
    // },
    CheckGrammar: {
      entry: [
        // Assign extracted information from user's input to the context
        assign(({ context }) => {
          // Get the latest recognized speech (convert it to lowercase for consistency)
          const utterance = context.lastResult?.[0]?.utterance.toLowerCase() || "";
    
          return {
            appointment: {
              ...context.appointment, // Keep existing appointment details
              person: getPerson(utterance) || context.appointment.person, // Extract name if available
            },
          };
        }),
    
        // Speak out the recognized utterance and check if it's in the grammar list
        { 
          type: "spst.speak",
          params: ({ context }) => ({
            utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
              isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
            } in your given list.`,
          }),
        },
      ],
      
      on: {
        SPEAK_COMPLETE: [
          {
            target: "Step2AskDay", // Move to the next step (asking for the day)
            guard: ({ context }) => !!context.appointment.person, // Only proceed if a valid person is assigned
          },
          {
            target: "Greeting.AskPerson", // Go back to ask again if no valid person was found
          },
        ],
      },
    },
    


    Step2AskDay: {
      initial: "AskDay",
      on: {
        LISTEN_COMPLETE: [
          {
            target: "CheckGrammar2",
            guard: ({ context }) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ],
      },
      states: {
        AskDay: {
          entry: { type: "spst.speak", params: { utterance: `On which day is your meeting?` } },
          on: { SPEAK_COMPLETE: "Ask2" },
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! On which day is your meeting?` },
          },
          on: { SPEAK_COMPLETE: "Ask2" },
        },
        Ask2: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({ event }) => {
                return { lastResult: event.value };
              }),
            },
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }),
            },
          },
        },
      },
    },

    // CheckGrammar2: {
    //   entry: {
    //     type: "spst.speak",
    //     params: ({ context }) => ({
    //       utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
    //         isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
    //       } in your given list.`,
    //     }),
    //   },
    //   on: { SPEAK_COMPLETE: "Step3AskWholeDay" },
    //   // on: { SPEAK_COMPLETE: "AppointmentCreated" },

    //   // check if day is in the list:
    //   // in the list -> go Step3AskWholeDay && assign the day to day property
    //   // not in the list -> go back to AskDay

    // },

    CheckGrammar2: {
      entry: [
        // Assign extracted day information from user's input to the context
        assign(({ context }) => {
          // Get the latest recognized speech (convert it to lowercase for consistency)
          const utterance = context.lastResult?.[0]?.utterance.toLowerCase() || "";
    
          return {
            appointment: {
              ...context.appointment, // Keep existing appointment details
              day: getDay(utterance) || context.appointment.day, // Extract day if available
            },
          };
        }),
    
        // Speak out the recognized utterance and check if it's in the grammar list
        {
          type: "spst.speak",
          params: ({ context }) => ({
            utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
              isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
            } in your given list.`,
          }),
        },
      ],
    
      on: {
        SPEAK_COMPLETE: [
          {
            target: "Step3AskWholeDay", // Move to the next step (asking if it's a full-day appointment)
            guard: ({ context }) => !!context.appointment.day, // Only proceed if a valid day is assigned
          },
          {
            target: "Step2AskDay", // Go back to ask for the day again if not recognized
          },
        ],
      },
    },
    

    Step3AskWholeDay:  {
      initial: "AskWholeDay",
      on: {
        LISTEN_COMPLETE: [
          {
            target: "CheckGrammarWholeDay3",
            guard: ({ context }) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ],
      },
      states: {
        AskWholeDay: {
          entry: { type: "spst.speak", params: { utterance: `Will it take the whole day?` } },
          on: { SPEAK_COMPLETE: "Ask3" },
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! Will it take the whole day??` },
          },
          on: { SPEAK_COMPLETE: "Ask3" },
        },
        Ask3: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: { 
              actions: assign(({ event }) => {
                
                return { lastResult: event.value };
              }),
            },
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }),
            },
          },
        },
      },
    },

    CheckGrammarWholeDay3: {
      entry: [
        // Assign extracted day information from user's input to the context
        assign(({ context }) => {
          // Get the latest recognized speech (convert it to lowercase for consistency)
          const utterance = context.lastResult?.[0]?.utterance.toLowerCase() || "";
    
          return {
            appointment: {
              ...context.appointment, // Keep existing appointment details
              confirmation: getConfirmation(utterance) || context.appointment.confirmation, // Extract day if available
            },
          };
        }),
    
        // Speak out the recognized utterance and check if it's in the grammar list
        {
          type: "spst.speak",
          params: ({ context }) => ({
            utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
              isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
            } in your given list.`,
          }),
        },
      ],

      on: {
        SPEAK_COMPLETE: [
          {
            target: "Step5AskConfirmation", 
            guard: ({ context }) => context.appointment.confirmation === "yes", // Only proceed if a valid day is assigned
          },

          {
            target: "Step4AskTime", 
            guard: ({ context }) => context.appointment.confirmation === "no", 
          },
          {
            target: "Step3AskWholeDay", 
          },
        ],
      },

    },


  

    Step4AskTime:{
      initial: "AskTime",
      on: {
        LISTEN_COMPLETE: [
          {
            target: "CheckGrammar4",
            guard: ({ context }) => !!context.lastResult,
          },
          { target: ".NoInput" },
        ],
      },
      states: {
        AskTime: {
          entry: { type: "spst.speak", params: { utterance: `What time is your meeting?` } },
          on: { SPEAK_COMPLETE: "Ask4" },
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! What time is your meeting?` },
          },
          on: { SPEAK_COMPLETE: "Ask4" },
        },
        Ask4: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({ event }) => {
                return { lastResult: event.value };
              }),
            },
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }),
            },
          },
        },
      },
    },

    // CheckGrammar4: {
    //   entry: {
    //     type: "spst.speak",
    //     params: ({ context }) => ({
    //       utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
    //         isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
    //       } in your given list.`,
    //     }),
    //   },
    //   // on: { SPEAK_COMPLETE: "Step5ConfirmAppointment" },
    //   on: { SPEAK_COMPLETE: "AppointmentCreated" },

    //   // check if day is in the list:
    //   // in the list -> go Step5ConfirmAppointment && assign the time to time property
    //   // not in the list -> go back to AskTime

    // },

    CheckGrammar4: {
      entry: [
        // Assign extracted time information from user's input to the context
        assign(({ context }) => {
          // Get the latest recognized speech (convert it to lowercase for consistency)
          const utterance = context.lastResult?.[0]?.utterance.toLowerCase() || "";
    
          return {
            appointment: {
              ...context.appointment, // Keep existing appointment details
              time: getTime(utterance) || context.appointment.time, // Extract time if available
            },
          };
        }),
    
        // Speak out the recognized utterance and check if it's in the grammar list
        {
          type: "spst.speak",
          params: ({ context }) => ({
            utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
              isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
            } in your given list.`,
          }),
        },
      ],
    
      on: {
        SPEAK_COMPLETE: [
          {
            // target: "AppointmentCreated", 
            target: "Step5AskConfirmation", 

            guard: ({ context }) => !!context.appointment.time, // Only proceed if a valid day is assigned
          },
          {
            target: "Step4AskTime", // Go back to ask for the day again if not recognized
          },
        ],
      },
    },

    // try4, no button is shown on the screen.

//     Step5AskConfirmation: {
//       initial: "AskConfirmation",
//       states: {
//         AskConfirmation: {
//           entry: [
//             {
//               type: "spst.speak",
//               params: ({ context }) => ({
//                 utterance: context.appointment.confirmation === "yes" || context.appointment.confirmation === "whole day"
//                   ? `Do you want me to create an appointment with ${context.appointment.person} on ${context.appointment.day} for the whole day?`
//                   : `Do you want me to create an appointment with ${context.appointment.person} on ${context.appointment.day} at ${context.appointment.time}?`,
//               }),
//             },
//           ], 
//           on: { SPEAK_COMPLETE: "GrammarCheck5" }, // After speaking, go to listening
//         },
    
//         NoInput: {
//           entry: {
//             type: "spst.speak",
//             params: { utterance: `I can't hear you! Please say yes or no.` },
//           },
//           on: { SPEAK_COMPLETE: "GrammarCheck5" }, // Retry listening
//         },
    
    
//     GrammarCheck5: {
//       entry: { type: "spst.listen" }, // Start listening
//       on: {
//         RECOGNISED: [
//           {
//             // target: "#DM.AppointmentCreated",
//             target: "#AppointmentCreated",

//             guard: ({ event }) => event.value?.[0]?.utterance?.toLowerCase() === "yes",
//           },
//           {
//             target: "#Greeting",
//             // target: "#DM.Greeting",

//             guard: ({ event }) => event.value?.[0]?.utterance?.toLowerCase() === "no",
//           },
//           {
//             target: "#Step5AskConfirmation", // Ask again if input is unrecognized
//           },
//         ],
//         ASR_NOINPUT: {
//           target: "#Step5AskConfirmation.NoInput", // Handle no input
//         },
//       },
//     },
    
//   },
// },

    //try5 a copy of try3, which button appeared, but logic is not right, //  not in the grammar - > Greeting
    Step5AskConfirmation:  {
      initial: "AskConfirmation",
      states: {
        AskConfirmation: {
          entry: [
            {
              type: "spst.speak",
              params: ({ context }) => ({
                utterance: context.appointment.confirmation === "yes" 
                  ? `Do you want me to create an appointment with ${context.appointment.person} on ${context.appointment.day} for the whole day?`
                  : `Do you want me to create an appointment with ${context.appointment.person} on ${context.appointment.day} at ${context.appointment.time}?`,
              }),
            },
          ], // something wrong with this entry.
          on: { SPEAK_COMPLETE: "Ask5" },
        },
        NoInput: {
          entry: {
            type: "spst.speak",
            params: { utterance: `I can't hear you! Please say yes or no` },
          },
          on: { SPEAK_COMPLETE: "Ask5" },
        },
        Ask5: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              target: "CheckGrammarAskConfirmation5",
              actions: assign(({ event }) => ({ lastResult: event.value })),
            },
            ASR_NOINPUT: {
              target: "NoInput",
            },
          },
        },
      },
    },

    CheckGrammarAskConfirmation5: {
      entry: [
        {
          type: "spst.speak",
          params: ({ context }) => {
            const utterance = context.lastResult?.[0]?.utterance?.toLowerCase() || "";  // ✅ Temporary variable
    
            return {
              utterance: `You just said: ${utterance}. And it ${
                isInGrammar(utterance) ? "is" : "is not"
              } in your given list.`,
            };
          },
        },
      ],

      on: {
        SPEAK_COMPLETE: [
          {
            target: "AppointmentCreated", 
            guard: ({ context }) => {
              const utterance = context.lastResult?.[0]?.utterance?.toLowerCase() || ""; // ✅ Temporary variable
              return utterance === "yes";
            },
          },
          {
            target: "Greeting", 
            guard: ({ context }) => {
              const utterance = context.lastResult?.[0]?.utterance?.toLowerCase() || ""; // ✅ Temporary variable
              return utterance === "no";
            },
          },
          {
            target: "Step5AskConfirmation.Ask5",  // ✅ Goes back to listening if unrecognized
          },
        ],
      },
    },




  

    //try3, button appeared, but logic is not right, //  not in the grammar - > Greeting

    // Step5AskConfirmation:  {
    //   initial: "AskConfirmation",
    //   on: {
    //     LISTEN_COMPLETE: [
    //       {
    //         target: "CheckGrammarAskConfirmation5",
    //         guard: ({ context }) => !!context.lastResult,
    //       },
    //       { target: ".NoInput" },
    //     ],
    //   },
    //   states: {
    //     AskConfirmation: {
    //       entry: [
    //         {
    //           type: "spst.speak",
    //           params: ({ context }) => ({
    //             utterance: context.appointment.confirmation === "yes" || context.appointment.confirmation === "whole day"
    //               ? `Do you want me to create an appointment with ${context.appointment.person} on ${context.appointment.day} for the whole day?`
    //               : `Do you want me to create an appointment with ${context.appointment.person} on ${context.appointment.day} at ${context.appointment.time}?`,
    //           }),
    //         },
    //       ], // something wrong with this entry.
    //       on: { SPEAK_COMPLETE: "Ask5" },
    //     },
    //     NoInput: {
    //       entry: {
    //         type: "spst.speak",
    //         params: { utterance: `I can't hear you! Please say yes or no` },
    //       },
    //       on: { SPEAK_COMPLETE: "Ask5" },
    //     },
    //     Ask5: {
    //       entry: { type: "spst.listen" },
    //       on: {
    //         RECOGNISED: { 
    //           actions: assign(({ event }) => {
                
    //             return { lastResult: event.value };
    //           }),
    //         },
    //         ASR_NOINPUT: {
    //           actions: assign({ lastResult: null }),
    //         },
    //       },
    //     },
    //   },
    // },

    // CheckGrammarAskConfirmation5: {
    //   entry: [
    //     // Assign extracted day information from user's input to the context
    //     assign(({ context }) => {
    //       // Get the latest recognized speech (convert it to lowercase for consistency)
    //       const utterance = context.lastResult?.[0]?.utterance.toLowerCase() || "";
    
    //       return {
    //         appointment: {
    //           ...context.appointment, // Keep existing appointment details
    //           confirmation: getConfirmation(utterance) || context.appointment.confirmation, // Extract day if available
    //         },
    //       };
    //     }),
    
    //     // Speak out the recognized utterance and check if it's in the grammar list
    //     {
    //       type: "spst.speak",
    //       params: ({ context }) => ({
    //         utterance: `You just said: ${context.lastResult![0].utterance}. And it ${
    //           isInGrammar(context.lastResult![0].utterance) ? "is" : "is not"
    //         } in your given list.`,
    //       }),
    //     },

    //   ],

    //   on: {
    //     SPEAK_COMPLETE: [
    //       {
    //         target: "AppointmentCreated", 
    //         guard: ({ context }) => context.appointment.confirmation === "yes", // Only proceed if a valid day is assigned
    //       },

    //       {
    //         target: "Greeting", 
    //         guard: ({ context }) => context.appointment.confirmation === "no", 
    //       },
    //       {
    //         target: "Step5AskConfirmation.NoInput",  //  not in the grammar - > 
    //       },
    //     ],
    //   },

    // },




    // //2.  this has button, but not waiting for an answer, let us improve it

    // Step5AskConfirmation: {
      // entry: [
      //   {
      //     type: "spst.speak",
      //     params: ({ context }) => ({
      //       utterance: context.appointment.confirmation === "yes" || context.appointment.confirmation === "whole day"
      //         ? `Do you want me to create an appointment with ${context.appointment.person} on ${context.appointment.day} for the whole day?`
      //         : `Do you want me to create an appointment with ${context.appointment.person} on ${context.appointment.day} at ${context.appointment.time}?`,
      //     }),
      //   },
      //   { type: "spst.listen" }, // Start listening for a response, it listen and speak at the same time.
      // ],
    
    //   on: {
    //     RECOGNISED: [ //has a result came back, compared with LISTEN_COMPLETE: this does not wait and give you a result
    //       {
    //         target: "AppointmentCreated",
    //         guard: ({ event }) => event.value?.[0]?.utterance.toLowerCase() === "yes", // also could reuse confirmation parameter, but I am not sure about this part.
    //       },
    //       {
    //         target: "Greeting.AskPerson", 
    //         guard: ({ event }) => event.value?.[0]?.utterance.toLowerCase() === "no",
    //       },

    //     ],
    //   },
    // },



    AppointmentCreated: {
      entry: { type: "spst.speak", params: { utterance: "Your appointment has been created." } },
      on: { CLICK: "Done" },
    },

    Done: {
      on: {
        CLICK: "Greeting",
      },
    },
  },
});

const dmActor = createActor(dmMachine, {
  inspect: inspector.inspect,
}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.debug("State value:", state.value);
  console.debug("State context:", state.context);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta(),
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
