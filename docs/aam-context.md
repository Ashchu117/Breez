# Advanced Air Mobility context for Breez

Navarro shared these references for the Florida Tech Showcase AI Hackathon. They provide research and policy context for the demo.

## Florida context

- FDOT identifies cargo logistics as an AAM use case and describes statewide planning, safety coordination, and collaboration with researchers and industry. Its AAM page also links the Florida advisory committee's roadmap and recommended standards. [FDOT Advanced Air Mobility](https://www.fdot.gov/aviation/advanced-air-mobility)
- SunTrax describes its Florida research and testing work across air and ground transportation, including eVTOL testing, aerial operations research, and workforce training. It identifies cargo delivery, medical transport, and disaster response as uses alongside passenger travel. [SunTrax Advanced Air Mobility](https://suntraxfl.com/suntrax-air/advanced-air-mobility/)

## Federal context

- The FAA summarizes the federal strategy and its phased implementation, including demonstrations and initial operations. [FAA Strategy & Vision](https://www.faa.gov/aam/strategy_vision)
- The national strategy gives the federal policy direction for 2026–2036, including staged rollout, airspace modernization, and passenger and cargo applications. [USDOT National Strategy](https://www.transportation.gov/sites/dot.gov/files/2025-12/AAM%20National%20Strategy%202025_508c_251201.pdf)
- The companion plan turns the strategy into staged actions. Its airspace recommendations discuss decision-support tools, sharing information among airspace users, and testing surveillance at low altitudes. [USDOT Comprehensive Plan](https://www.transportation.gov/sites/dot.gov/files/2025-12/AAM%20Comprehensive%20Plan%202025.pdf)
- NASA's research covers low-altitude passenger transport, cargo delivery, and public services. Its AAM page links research on air traffic management and system-wide safety. [NASA Advanced Air Mobility](https://www.nasa.gov/mission/advanced-air-mobility/)

## How this informs the hackathon demo

Breez helps a Florida delivery planner turn an incomplete request into a mission that a person can review. The planned demo starts with a small mock food delivery. The concierge collects the request details, the user confirms the pickup and drop-off, and Python evaluates a simulated route. Show a route that passes the demo checks and another that intersects a simulated restriction. The briefing should point to the affected segment and the reason so a person can decide whether to approve the simulation or hold it.

Use public or fictional locations. Label simulated restrictions and travel-time assumptions. Show the live aircraft overlay as situational context, outside the route checks. The research and policy links support the use case, and the prototype is for planning and human review in simulation.

For the judges' Future Work question, discuss validating the workflow in a controlled test environment, identifying authoritative airspace and surveillance data, and working with operators and local stakeholders before considering operational use. SunTrax is a Florida example of that research and testing context.
